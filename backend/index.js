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
const MONGODB_ATLAS_DB_NAME = "knowledgeBase";
const MONGODB_ATLAS_COLLECTION_NAME = "documentChunks";
const ATLAS_VECTOR_SEARCH_INDEX_NAME = "langchain-test-index-vectorstores";
const DOCUMENTS_PATH = "./documents";

const client = new MongoClient(MONGODB_URL);
const collection = client.db(MONGODB_ATLAS_DB_NAME).collection(MONGODB_ATLAS_COLLECTION_NAME);

const embeddings = new OllamaEmbeddings({ model: "llama3.2:latest" });

const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
  collection,
  indexName: ATLAS_VECTOR_SEARCH_INDEX_NAME,
  textKey: "text",
  embeddingKey: "embedding",
});

async function calculateFileHash(filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

app.post("/embedding", async (req, res) => {
  try {
    const files = await fs.promises.readdir(DOCUMENTS_PATH);
    const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    // Ensure MongoDB connection is open
    await client.connect();

    for (const pdfFile of pdfFiles) {
      try {
        const filePath = path.join(DOCUMENTS_PATH, pdfFile);
        const stats = await fs.promises.stat(filePath);
        const currentHash = await calculateFileHash(filePath);

        // Check for existing documents with this filename
        const existingDoc = await collection.findOne({
          "metadata.originalName": pdfFile
        }, {
          sort: { "metadata.uploadedAt": -1 } // Get the most recent
        });

        if (existingDoc) {
          // Compare hash and modification time
          const previousHash = existingDoc.metadata.fileHash;
          const previousModified = existingDoc.metadata.fileModified;

          if (previousHash === currentHash &&
            new Date(previousModified).getTime() === stats.mtime.getTime()) {
            skippedCount++;
            console.log(`Skipping ${pdfFile} - no changes detected`);
            continue;
          }

          // If file changed, remove old chunks
          console.log(`Detected changes in ${pdfFile}, removing old embeddings...`);
          await collection.deleteMany({ "metadata.originalName": pdfFile });
          updatedCount++;
        }

        // Process the PDF (either new or updated)
        const loader = new PDFLoader(filePath, { splitPages: true });
        const docs = await loader.load();

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        });

        const splitDocs = await splitter.splitDocuments(docs);

        // Prepare documents with enhanced metadata
        const documents = splitDocs.map((doc) => ({
          pageContent: doc.pageContent,
          metadata: {
            ...doc.metadata,
            originalName: pdfFile,
            uploadedAt: new Date(),
            fileHash: currentHash,
            fileModified: stats.mtime,
            fileSize: stats.size
          },
        }));

        // Store in vector database
        await vectorStore.addDocuments(documents);
        processedCount++;
        console.log(`Successfully embedded ${pdfFile}`);

      } catch (error) {
        console.error(`Error processing ${pdfFile}:`, error);
        errors.push({ file: pdfFile, error: error.message });
      }
    }

    res.json({
      success: true,
      message: "Embedding process completed",
      processed: processedCount,
      updated: updatedCount,
      skipped: skippedCount,
      errors: errors
    });
  } catch (error) {
    console.error("Embedding process failed:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    // Consider whether to close the connection here or manage it elsewhere
    // await client.close();
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
