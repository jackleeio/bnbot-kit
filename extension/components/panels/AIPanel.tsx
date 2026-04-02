import React, { useState } from 'react';
    import { Sparkles, PenTool, ShieldCheck, Search, Image as ImageIcon, ChevronLeft } from 'lucide-react';
    import { geminiService } from '../../services/geminiService';
    import { Button } from '../Button';
    
    const TOOLS = [
      { id: 'sentiment', name: 'Sentiment Check', icon: ShieldCheck, desc: 'Analyze draft vibes.' },
      { id: 'draft', name: 'Viral Drafter', icon: PenTool, desc: 'Rewrite for engagement.' },
      { id: 'fact', name: 'Fact Checker', icon: Search, desc: 'Verify claims quickly.' },
      { id: 'image', name: 'Thread Visuals', icon: ImageIcon, desc: 'Idea to Image prompt.' },
    ];
    
    export const AIPanel: React.FC = () => {
      const [selectedTool, setSelectedTool] = useState<string | null>(null);
      const [inputText, setInputText] = useState('');
      const [result, setResult] = useState('');
      const [loading, setLoading] = useState(false);
    
      const handleExecute = async () => {
        if (!selectedTool || !inputText) return;
        setLoading(true);
        setResult('');
        
        try {
          const prompt = `Act as a ${selectedTool} tool for Twitter. Process this input: "${inputText}"`;
          const res = await geminiService.analyzeTweet(prompt); // Reusing general generate method
          setResult(res);
        } catch (e) {
            setResult('Error executing tool.');
        } finally {
          setLoading(false);
        }
      };
    
      return (
        <div className="flex flex-col h-full bg-transparent">
          <div className="p-4 pt-10 space-y-6 overflow-y-auto pb-20">
            {!selectedTool ? (
              <div className="grid grid-cols-2 gap-3">
                {TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => setSelectedTool(tool.id)}
                    className="flex flex-col items-center justify-center p-5 bg-[var(--bg-primary)] rounded-2xl hover:bg-[var(--hover-bg)] transition-all border border-[var(--border-color)] hover:border-[var(--accent-color)] group shadow-sm hover:shadow-md"
                  >
                    <div className="p-3 bg-[var(--bg-secondary)] rounded-full mb-3 group-hover:bg-[var(--accent-bg-light)] group-hover:text-[var(--accent-text)] text-[var(--text-secondary)] transition-colors ring-1 ring-[var(--border-color)] group-hover:ring-[var(--accent-color)]">
                      <tool.icon size={24} />
                    </div>
                    <span className="font-bold text-[var(--text-primary)] text-sm">{tool.name}</span>
                    <span className="text-xs text-[var(--text-secondary)] mt-1">{tool.desc}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-right-5 duration-300">
                <button 
                    onClick={() => {
                        setSelectedTool(null);
                        setResult('');
                        setInputText('');
                    }} 
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-4 flex items-center gap-1 font-medium bg-[var(--bg-secondary)] px-3 py-1.5 rounded-full w-fit transition-colors"
                >
                    <ChevronLeft size={12} /> Back to tools
                </button>
                
                <div className="bg-[var(--bg-primary)] rounded-2xl p-4 border border-[var(--border-color)] mb-4 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                     <div className="p-2 bg-[var(--accent-bg-light)] rounded-lg">
                        {React.createElement(TOOLS.find(t => t.id === selectedTool)?.icon || Sparkles, { size: 20, className: "text-[var(--accent-text)]" })}
                     </div>
                     <h3 className="text-lg font-bold text-[var(--text-primary)]">
                        {TOOLS.find(t => t.id === selectedTool)?.name}
                     </h3>
                  </div>

                  <textarea
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-color)] transition-colors min-h-[120px] resize-none mb-4"
                    placeholder="Paste tweet or text here..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                  />
      
                  <Button 
                      variant="primary" 
                      className="w-full !bg-[var(--accent-color)] hover:!opacity-90 !text-black !py-3 !rounded-xl" 
                      onClick={handleExecute}
                      isLoading={loading}
                      disabled={!inputText}
                  >
                      Generate Analysis
                  </Button>
                </div>
    
                {result && (
                  <div className="p-5 bg-[var(--bg-primary)] rounded-2xl border border-[var(--border-color)] animate-in zoom-in-95 duration-200 shadow-sm">
                    <h4 className="text-[10px] font-bold text-[var(--accent-text)] uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Sparkles size={10} /> AI Result
                    </h4>
                    <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">{result}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    };