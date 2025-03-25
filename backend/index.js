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


const GPT_MODEL = "llama3.2:latest";
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
const embeddings = new OllamaEmbeddings({ model: GPT_MODEL });
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
          await chunksCollection.deleteMany({ "metadata.originalName": pdfFile });
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

    // Initialize LLM
    const llm = new ChatOllama({
      model: GPT_MODEL,
      streaming: true,
    });

    // 1. Search relevant documents from vector store
    const relevantDocs = await vectorStore.similaritySearch(prompt, 3);
    const context = relevantDocs.map((doc) => doc.pageContent).join("\n\n");

    // 2. Determine response strategy based on context availability
    let message;
    if (relevantDocs.length === 0) {
      // No context found - use generic response
      message = new HumanMessage({
        content: `I couldn't find specific information about "${prompt}" in my knowledge base. ` +
          `However, I can try to help based on my general knowledge. ` +
          `Could you please rephrase your question or provide more details?\n\n` +
          `Question: ${prompt}`
      });
    } else {
      // Context found - use RAG approach
      message = new HumanMessage({
        content: `Please answer the question using this context:\n${context}\n\n` +
          `Question: ${prompt}\n\n` +
          `If the context doesn't contain the answer, say "I'm sorry, I don't have enough information about that specific topic."`
      });
    }

    // 3. Stream the response
    const stream = await llm.stream([message]);

    // Helper function to write SSE messages
    const writeSSE = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Stream chunks
    for await (const chunk of stream) {
      writeSSE({
        model: GPT_MODEL,
        created_at: new Date().toISOString(),
        response: chunk.content,
        context_used: relevantDocs.length > 0,
        done: false
      });
    }

    // Final message
    writeSSE({
      model: GPT_MODEL,
      created_at: new Date().toISOString(),
      response: "",
      context_used: relevantDocs.length > 0,
      done: true
    });

    res.end();

  } catch (error) {
    console.error("Error:", error);

    const errorResponse = {
      model: GPT_MODEL,
      created_at: new Date().toISOString(),
      response: "I'm sorry, I encountered an error processing your request.",
      error: error.message,
      done: true
    };

    if (!res.headersSent) {
      res.status(500).json(errorResponse);
    } else {
      res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
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
});
