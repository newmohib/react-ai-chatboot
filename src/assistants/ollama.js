/* eslint-disable no-unused-vars */
/* eslint-disable no-useless-catch */
export class Assistant {
  constructor(model = "gemma3:1b") {
    this.model = model;
    this.apiUrl = "http://localhost:3000/message"; // Corrected API URL
  }

  // Function for standard non-streaming chat
  async chat(content) {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: {
          model: this.model,
          prompt: content,
          stream: false, // Disable streaming for normal response
        },
      });

      console.log({ response });

      if (!response.ok) {
        throw new Error(`Ollama API Error: ${response.status}`);
      }

      const data = await response.json(); // Assuming response is JSON
      return data.response; // Return the generated text from Ollama API
    } catch (error) {
      throw new Error(`Error: ${error.message}`);
    }
  }

  // Function for streaming chat
  async *chatStream(content) {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: content,
          stream: true, // Enable streaming
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API Error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split the buffer into lines
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep the last incomplete line

        // Process each complete line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            yield json.response; // Yield the response text from the stream
          } catch (err) {
            console.error("Failed to parse JSON chunk:", line);
          }
        }
      }
    } catch (error) {
      throw new Error(`Error: ${error.message}`);
    }
  }
}
