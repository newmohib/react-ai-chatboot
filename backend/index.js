import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { HumanMessage } from "@langchain/core/messages";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import cors from "cors";
import express from "express";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MongoClient } from "mongodb";
import multer from "multer";
// import fs from "fs/promises";
import path from "path";

const app = express();
const PORT = 3000;
const upload = multer({ storage: multer.memoryStorage() });

// MongoDB Configuration
const MONGODB_URL = "mongodb://localhost:27017";
const MONGODB_ATLAS_DB_NAME = "knowledgeBase";
const MONGODB_ATLAS_COLLECTION_NAME = "documentChunks";
const ATLAS_VECTOR_SEARCH_INDEX_NAME = "langchain-test-index-vectorstores";

const client = new MongoClient(MONGODB_URL);

const collection = client
  .db(MONGODB_ATLAS_DB_NAME)
  .collection(MONGODB_ATLAS_COLLECTION_NAME);

const embeddings = new OllamaEmbeddings({
  model: "llama3.2:latest",
});

const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
  collection: collection,
  indexName: ATLAS_VECTOR_SEARCH_INDEX_NAME,
  textKey: "text",
  embeddingKey: "embedding",
});

app.use(cors());
app.use(express.json());

// PDF Upload and Processing Endpoint
// app.post("/upload", upload.single("file"), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "No file uploaded" });
//     }

//     // Load PDF
//     const loader = new PDFLoader(req.file.buffer);
//     const docs = await loader.load();

//     // Split text into chunks
//     const splitter = new RecursiveCharacterTextSplitter({
//       chunkSize: 1000,
//       chunkOverlap: 200,
//     });
//     const splitDocs = await splitter.splitDocuments(docs);

//     // Add metadata and store in MongoDB
//     const documents = splitDocs.map((doc) => ({
//       pageContent: doc.pageContent,
//       metadata: {
//         ...doc.metadata,
//         originalName: req.file.originalname,
//         uploadedAt: new Date(),
//       },
//     }));

//     await vectorStore.addDocuments(documents);

//     res.json({ success: true, chunks: documents.length });
//   } catch (error) {
//     console.error("Upload error:", error);
//     res.status(500).json({ error: error.message });
//   }
// });

// For static file processing

// For static file processing
app.post("/process-static-pdf", async (req, res) => {
  try {
    // eslint-disable-next-line no-undef
    const pdfPath = path.join(process.cwd(), "documents", "knowledge.pdf");

    // Method 1: Using file path directly
    // const loader = new PDFLoader(pdfPath);
    const loader = new PDFLoader(pdfPath, {
      splitPages: true,
    });

    // OR Method 2: Using file buffer
    // const fileBuffer = await fs.readFile(pdfPath);
    // const loader = new PDFLoader(fileBuffer);

    const docs = await loader.load();

    // Rest of your processing...
    res.json({ success: true, chunks: docs.length });
  } catch (error) {
    console.error("Static PDF processing error:", error);
    res.status(500).json({ error: error.message });
  }
});

// For file uploads (keeping your original but fixed)
app.post("/upload", async (req, res) => {
  try {
    // Create loader from buffer
    const loader = new PDFLoader("./documents/HelloWorld.pdf", {
      splitPages: true,
    });

    const docs = await loader.load();
    // Rest of your processing code remains the same...
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const splitDocs = await splitter.splitDocuments(docs);
    console.log({ splitDocs });

    // Add metadata and store in MongoDB
    const documents = splitDocs.map((doc) => ({
      pageContent: doc.pageContent,
      metadata: {
        ...doc.metadata,
        originalName: "HelloWorld.pdf",
        uploadedAt: new Date(),
      },
    }));

    await vectorStore.addDocuments(documents);

    // Rest of your processing...
    res.json({ success: true, chunks: docs.length });
  } catch (error) {
    console.error("Upload processing error:", error);
    res.status(500).json({ error: error.message });
  }
});

// app.post("/upload", upload.single("file"), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "No file uploaded" });
//     }

//     // Load PDF using the correct loader
//     const loader = new PDFLoader(req.file.buffer, {
//       splitPages: true, // Optional: keep pages separate
//     });

//     const docs = await loader.load();

//     // Rest of your processing code remains the same...
//     const splitter = new RecursiveCharacterTextSplitter({
//       chunkSize: 1000,
//       chunkOverlap: 200,
//     });

//     const splitDocs = await splitter.splitDocuments(docs);
//     // Add metadata and store in MongoDB
//     const documents = splitDocs.map((doc) => ({
//       pageContent: doc.pageContent,
//       metadata: {
//         ...doc.metadata,
//         originalName: req.file.originalname,
//         uploadedAt: new Date(),
//       },
//     }));

//     await vectorStore.addDocuments(documents);
//   } catch (error) {
//     console.error("Upload error:", error);
//     res.status(500).json({ error: error.message });
//   }
// });

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
