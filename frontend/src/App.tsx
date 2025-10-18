import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Mail } from 'lucide-react';
import { ChatMessage } from './components/ChatMessage';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { ScrollArea } from './components/ui/scroll-area';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || !recipientEmail.trim() || !recipientName.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: `发送邮件给 ${recipientName} (${recipientEmail}): ${input.trim()}`,
    };

    setMessages(prev => [...prev, userMessage]);
    const originalInput = input.trim();
    setInput('');
    setIsLoading(true);

    // Create assistant message placeholder
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Close existing connection if any
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Prepare request data
      const requestData = {
        to: recipientEmail.trim(),
        recipient: recipientName.trim(),
        intent: originalInput,
        language: 'zh-CN',
      };

      // Make POST request to establish SSE connection
      const response = await fetch('http://localhost:3000/api/agent/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Create EventSource from the response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  
                  if (data.content) {
                    // Handle token event - append content
                    setMessages(prev =>
                      prev.map(msg =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: msg.content + data.content + ' ' }
                          : msg
                      )
                    );
                  }
                } catch (e) {
                  // Ignore malformed JSON
                }
              } else if (line.startsWith('event: ')) {
                const eventType = line.slice(8);
                if (eventType === 'done') {
                  // Mark streaming as complete
                  setMessages(prev =>
                    prev.map(msg =>
                      msg.id === assistantMessageId
                        ? { ...msg, isStreaming: false }
                        : msg
                    )
                  );
                  setIsLoading(false);
                  return;
                } else if (eventType === 'error') {
                  setMessages(prev =>
                    prev.map(msg =>
                      msg.id === assistantMessageId
                        ? {
                            ...msg,
                            content: msg.content || '处理请求时发生错误，请稍后重试。',
                            isStreaming: false,
                          }
                        : msg
                    )
                  );
                  setIsLoading(false);
                  return;
                }
              }
            }
          }
        } catch (error) {
          console.error('Stream processing error:', error);
          setMessages(prev =>
            prev.map(msg =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: msg.content || '连接中断，请检查网络连接后重试。',
                    isStreaming: false,
                  }
                : msg
            )
          );
          setIsLoading(false);
        }
      };

      await processStream();

    } catch (error) {
      console.error('Error:', error);
      
      // Show error message
      setMessages(prev =>
        prev.map(msg =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: `连接失败：${error instanceof Error ? error.message : '未知错误'}。请确保后端服务正在运行在 http://localhost:3000`,
                isStreaming: false,
              }
            : msg
        )
      );
      
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const canSend = input.trim() && recipientEmail.trim() && recipientName.trim() && !isLoading;

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-slate-900">TREA</h1>
            <p className="text-slate-500">The Real Email Agent</p>
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="max-w-4xl mx-auto px-6 py-8">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-6">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-slate-900 mb-2">开始与 TREA 对话</h2>
                <p className="text-slate-600 max-w-md">
                  告诉我你要和谁沟通、想达成什么，我会帮你撰写和发送专业的邮件。
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    isStreaming={message.isStreaming}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          {/* Email Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="space-y-2">
              <Label htmlFor="recipientEmail" className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                收件人邮箱
              </Label>
              <Input
                id="recipientEmail"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="example@company.com"
                className="rounded-xl border-slate-200 focus:border-blue-500 focus:ring-blue-500"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipientName" className="text-sm font-medium text-slate-700">
                收件人姓名/描述
              </Label>
              <Input
                id="recipientName"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="张总 / 产品经理 / 客户代表"
                className="rounded-xl border-slate-200 focus:border-blue-500 focus:ring-blue-500"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Message Input */}
          <div className="flex gap-3 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="告诉 TREA 你想要做什么..."
              className="flex-1 min-h-[56px] max-h-[200px] resize-none rounded-2xl border-slate-200 focus:border-blue-500 focus:ring-blue-500"
              disabled={isLoading}
            />
            <Button
              onClick={handleSendMessage}
              disabled={!canSend}
              className="h-[56px] px-6 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 hover:shadow-lg transition-all duration-200"
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>
          <p className="text-slate-400 mt-2 text-center">
            按 Enter 发送，Shift + Enter 换行
          </p>
        </div>
      </div>
    </div>
  );
}
