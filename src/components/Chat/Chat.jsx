/* eslint-disable react/prop-types */
import { useRef, useEffect, useMemo } from "react";
import Markdown from "react-markdown";
import styles from "./Chat.module.css";
import { Loader } from "../Loader/Loader";

const WELCOME_MESSAGE_GROUP = [
  {
    role: "assistant",
    content: "Hello! How can I assist you right now?",
  },
];

export function Chat({ messages, isLoading }) {
  const messagesEndRef = useRef(null);
  const messagesGroups = useMemo(
    () =>
      messages.reduce((groups, message) => {
        if (message.role === "user") groups.push([]);
        groups[groups.length - 1].push(message);
        return groups;
      }, []),
    [messages]
  );

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];

    if (lastMessage?.role === "user") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className={styles.Chat}>
      {[WELCOME_MESSAGE_GROUP, ...messagesGroups].map(
        (messages, groupIndex) => {
          console.log({ isLoading });

          if (isLoading) {
            return (
              <div key={groupIndex} className={styles.Group}>
                <div className={styles.Message} data-role="assistant">
                  <Loader />
                </div>
              </div>
            );
          }
          return (
            <div key={groupIndex} className={styles.Group}>
              {messages.map(({ role, content }, index) => (
                // Message
                <div key={index} className={styles.Message} data-role={role}>
                  <Markdown>{content}</Markdown>
                </div>
              ))}
            </div>
          );
        }
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
