import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
const PORT = 3000;

app.use(cors());

// Use express.json() to parse incoming JSON request bodies
app.use(express.json()); // This is necessary to parse JSON data

// Stream API from Ollama and return to frontend
app.post("/message", async (req, res) => {
  try {
    console.log(req.body); // This should now print the parsed JSON body
    const { prompt } = req.body; // Extract the prompt from the body

    const ollamaResponse = await axios({
      method: "post",
      url: "http://localhost:11434/api/generate", // Ollama API URL
      data: {
        model: "gemma3:1b",
        prompt: prompt,
        stream: true, // Ensure streaming is enabled
      },
      responseType: "stream", // Ensure we're getting a stream response
    });

    // Set response headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Pipe Ollama response stream to the frontend
    ollamaResponse.data.pipe(res); // Use the `pipe` method to forward the stream to the client

    // Optional: Handle the "end" of the stream from Ollama if needed
    ollamaResponse.data.on("end", () => {
      console.log("Stream ended");
      res.end(); // End the response when the stream ends
    });
  } catch (error) {
    console.error("Error fetching Ollama stream:", error.message);
    res.status(500).send("Error streaming response");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
