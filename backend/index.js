import express from "express";
import cors from "cors";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage } from "@langchain/core/messages";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.post("/message", async (req, res) => {
  try {
    const { prompt } = req.body;

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const llm = new ChatOllama({
      model: "gemma3:1b",
      streaming: true,
    });

    // Create proper LangChain message object
    const message = new HumanMessage(prompt);

    const stream = await llm.stream([message]);

    // Stream the response chunks
    for await (const chunk of stream) {
      // Format to match Ollama's API response structure
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
