/* eslint-disable no-unused-vars */
import { useState } from "react";
import { Assistant } from "./assistants/ollama";
import { Loader } from "./components/Loader/Loader";
import { Chat } from "./components/Chat/Chat";
import { Controls } from "./components/Controls/Controls";
import styles from "./App.module.css";

function App() {
  const assistant = new Assistant();
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  function updateLastMessageContent(content) {
    setMessages((prevMessages) =>
      prevMessages.map((message, index) =>
        index === prevMessages.length - 1
          ? { ...message, content: `${message.content}${content}` }
          : message
      )
    );
  }

  function addMessage(message) {
    setMessages((prevMessages) => [...prevMessages, message]);
  }

  async function handleContentSend(content) {
    addMessage({ content, role: "user" });
    setIsLoading(true);
    try {
      const result = await assistant.chatStream(content, messages);
      console.log({ result });

      let isFirstChunk = false;

      for await (const chunk of result) {
        if (!isFirstChunk) {
          isFirstChunk = true;
          addMessage({ content: "", role: "assistant" });
          setIsLoading(false);
          setIsStreaming(true);
        }

        updateLastMessageContent(chunk);
      }

      setIsStreaming(false);
    } catch (error) {
      addMessage({
        content: "Sorry, I couldn't process your request. Please try again!",
        role: "system",
      });
      setIsLoading(false);
      setIsStreaming(false);
    }
  }

  return (
    <div className={styles.App}>
      {/* {isLoading && <Loader />} */}
      <div className={styles.ChatBotContainer}>
        {!isChatOpen && (
          <button
            className={styles.ChatBotButton}
            onClick={() => setIsChatOpen(true)}
          >
            <img src="/chat-bot.png" alt="Chatbot" />
          </button>
        )}
        {isChatOpen && (
          <div className={styles.ChatBox}>
            <header className={styles.ChatHeader}>
              <h3>AI Chatbot</h3>
              <button
                className={styles.CloseButton}
                onClick={() => setIsChatOpen(false)}
              >
                ✖
              </button>
            </header>

            <div className={styles.ChatContainer}>
              <Chat isLoading={isLoading} messages={messages} />
            </div>
            <Controls
              isDisabled={isLoading || isStreaming}
              onSend={handleContentSend}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
