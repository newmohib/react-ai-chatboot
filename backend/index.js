import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { HumanMessage } from "@langchain/core/messages";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MongoClient } from "mongodb";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Configuration
const MONGODB_URL = "mongodb://localhost:27017";
const DB_NAME = "chatbotdb";
const CHUNKS_COLLECTION = "documentChunks";
const METADATA_COLLECTION = "documentsMetadata";
const SEARCH_INDEX_NAME = "message-context-index";
const DOCUMENTS_PATH = "./documents";

// MongoDB Client and Collections
const client = new MongoClient(MONGODB_URL);
const db = client.db(DB_NAME);
const chunksCollection = db.collection(CHUNKS_COLLECTION);
const metadataCollection = db.collection(METADATA_COLLECTION);

// Vector Store Configuration
const embeddings = new OllamaEmbeddings({ model: "llama3.2:latest" });
const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
  collection: chunksCollection,
  indexName: SEARCH_INDEX_NAME,
  textKey: "text",
  embeddingKey: "embedding",
});

// Initialize the database
async function initializeDatabase() {
  try {
    await client.connect();
    // Create indexes
    await metadataCollection.createIndex({ fileName: 1 }, { unique: true });
    await metadataCollection.createIndex({ lastProcessed: 1 });

    console.log("Database connected and indexes verified");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}

// Helper function to calculate file hash
async function calculateFileHash(filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// Embedding Endpoint
app.post("/embedding", async (req, res) => {
  try {
    const files = await fs.promises.readdir(DOCUMENTS_PATH);
    const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    await client.connect();

    for (const pdfFile of pdfFiles) {
      try {
        const filePath = path.join(DOCUMENTS_PATH, pdfFile);
        const stats = await fs.promises.stat(filePath);
        const currentHash = await calculateFileHash(filePath);

        // Check file tracker collection
        const fileRecord = await metadataCollection.findOne({
          fileName: pdfFile
        });

        if (fileRecord) {
          // Compare with previous version
          if (fileRecord.fileHash === currentHash &&
            new Date(fileRecord.modifiedAt).getTime() === stats.mtime.getTime()) {
            skippedCount++;
            console.log(`Skipping ${pdfFile} - no changes detected`);
            continue;
          }

          // File changed - remove old chunks
          console.log(`Detected changes in ${pdfFile}, removing old embeddings...`);
          await collection.deleteMany({ "metadata.originalName": pdfFile });
          updatedCount++;
        }

        // Process the PDF
        const loader = new PDFLoader(filePath, { splitPages: true });
        const docs = await loader.load();

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        });

        const splitDocs = await splitter.splitDocuments(docs);

        // Prepare documents with metadata
        const documents = splitDocs.map((doc) => ({
          pageContent: doc.pageContent,
          metadata: {
            ...doc.metadata,
            originalName: pdfFile,
            versionId: new Date().getTime(), // Using timestamp as version ID
            uploadedAt: new Date()
          },
        }));

        // Store chunks in vector database
        await vectorStore.addDocuments(documents);

        // Update or create file tracker record
        await metadataCollection.updateOne(
          { fileName: pdfFile },
          {
            $set: {
              fileHash: currentHash,
              modifiedAt: stats.mtime,
              size: stats.size,
              lastProcessed: new Date(),
              versionId: new Date().getTime()
            }
          },
          { upsert: true }
        );

        processedCount++;
        console.log(`Successfully processed ${pdfFile}`);

      } catch (error) {
        console.error(`Error processing ${pdfFile}:`, error);
        errors.push({ file: pdfFile, error: error.message });
      }
    }

    res.json({
      success: true,
      message: "Embedding process completed",
      stats: {
        new: processedCount - updatedCount,
        updated: updatedCount,
        skipped: skippedCount
      },
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error("Embedding process failed:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// Enhanced Chat Endpoint with Vector Search
app.post("/message", async (req, res) => {
  try {
    const { prompt } = req.body;

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // 1. First search relevant documents from vector store
    const relevantDocs = await vectorStore.similaritySearch(prompt, 3);
    const context = relevantDocs.map((doc) => doc.pageContent).join("\n\n");

    const llm = new ChatOllama({
      model: "gemma3:1b",
      streaming: true,
    });

    // Create message with context
    const message = new HumanMessage({
      content: `Context: ${context}\n\nQuestion: ${prompt}`,
    });

    const stream = await llm.stream([message]);

    // Stream the response chunks
    for await (const chunk of stream) {
      const responseData = {
        model: "gemma3:1b",
        created_at: new Date().toISOString(),
        response: chunk.content,
        done: false,
      };
      res.write(`data: ${JSON.stringify(responseData)}\n\n`);
    }

    // Send final done message
    const doneMessage = {
      model: "gemma3:1b",
      created_at: new Date().toISOString(),
      response: "",
      done: true,
    };
    res.write(`data: ${JSON.stringify(doneMessage)}\n\n`);
    res.end();
  } catch (error) {
    console.error("Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      const errorData = {
        model: "gemma3:1b",
        created_at: new Date().toISOString(),
        response: "",
        error: error.message,
        done: true,
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
    }
  }
});

const PORT = 3000;

// Call this when starting your application
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});
