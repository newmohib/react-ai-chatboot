/* eslint-disable no-unused-vars */
/* eslint-disable no-useless-catch */
export class Assistant {
  constructor(model = "gemma3:1b") {
    this.model = model;
    this.apiUrl = "http://localhost:3000/message";
  }

  // Function for standard non-streaming chat
  async chat(content) {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: content,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      return data.response || data.content;
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
          prompt: content,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          buffer += decoder.decode(value, { stream: true });

          // Process each complete event (separated by double newlines)
          const events = buffer.split("\n\n");
          buffer = events.pop(); // Save incomplete chunk

          for (const event of events) {
            if (!event.trim()) continue;

            try {
              // Extract data from SSE format (data: {...})
              const dataStr = event.replace("data: ", "").trim();
              if (!dataStr) continue;

              const json = JSON.parse(dataStr);
              yield json.content || json.response || "";
            } catch (err) {
              console.error("Error parsing event:", event, err);
            }
          }
        }
      }
    } catch (error) {
      throw new Error(`Error: ${error.message}`);
    }
  }
}
