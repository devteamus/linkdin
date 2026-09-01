'use client';

import { useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';

const TELEGRAM_URL = 'https://t.me/AaruViestaa';

export default function TelegramChat() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-80 rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden"
          >
            {/* Header */}
            <div className="bg-[#0A66C2] px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-white/20 flex items-center justify-center">
                  <Send className="size-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-white text-sm">PostGo Support</p>
                  <div className="flex items-center gap-1.5">
                    <div className="size-2 rounded-full bg-green-400" />
                    <p className="text-white/80 text-xs">Online now</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/80 hover:text-white transition-colors"
                aria-label="Close chat"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5">
              <div className="bg-gray-50 rounded-xl rounded-tl-sm p-4 mb-4">
                <p className="text-sm text-gray-700 leading-relaxed">
                  Hi there! 👋 Need help with PostGo? Chat with us on Telegram for quick support.
                </p>
                <p className="text-xs text-gray-400 mt-2">Typically replies within minutes</p>
              </div>
              <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                <Button className="w-full h-11 gap-2 bg-[#0A66C2] hover:bg-[#004182] text-white">
                  <MessageCircle className="size-4" />
                  Open Telegram Chat
                </Button>
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Button */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="size-14 rounded-full bg-[#0A66C2] hover:bg-[#004182] shadow-lg hover:shadow-xl transition-all flex items-center justify-center text-white"
        aria-label={isOpen ? 'Close support chat' : 'Open support chat'}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <X className="size-6" />
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <MessageCircle className="size-6" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
