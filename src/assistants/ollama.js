/* eslint-disable no-unused-vars */
/* eslint-disable no-useless-catch */
export class Assistant {
  constructor(model = "gemma3:1b") {
    this.model = model;
    this.apiUrl = "http://localhost:11434/api/generate"; // Ollama API
  }

  async chat(content) {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: content,
          stream: false,
        }),
      });
      console.log({ response });

      if (!response.ok) throw new Error(`Ollama API Error: ${response.status}`);

      const data = await response.json();
      return data.response; // Returns the generated text
    } catch (error) {
      throw error;
    }
  }

  async *chatStream(content) {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: content,
          stream: true,
        }),
      });

      if (!response.ok) throw new Error(`Ollama API Error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process each JSON object correctly
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep the last incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            yield json.response; // Only yield response text
          } catch (err) {
            console.error("Failed to parse JSON chunk:", line);
          }
        }
      }
    } catch (error) {
      throw error;
    }
  }
}
