import React, { useState } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

interface BoostModalProps {
    tweetText: string;
    onClose: () => void;
}

export function BoostModal({ tweetText, onClose }: BoostModalProps) {
    const { t } = useLanguage();
    const [ageRange, setAgeRange] = useState<[number, number]>([18, 55]);

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100000,
            pointerEvents: 'auto'
        }} onClick={onClose}>
            <div style={{
                backgroundColor: '#fff',
                borderRadius: '16px',
                width: '600px',
                padding: '0',
                boxShadow: '0 0 15px rgba(0,0,0,0.1)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{
                    padding: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px'
                }}>
                    <button onClick={onClose} style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }} className="hover:bg-gray-100 transition-colors">
                        <X size={20} color="#000" />
                    </button>

                    <div style={{ flex: 1 }}></div>
                </div>

                {/* Content */}
                <div style={{ padding: '0 32px 32px 32px' }}>

                    <h1 style={{
                        fontSize: '23px',
                        fontWeight: 800,
                        marginBottom: '32px',
                        color: '#0f1419'
                    }}>
                        你想要覆盖哪些人？
                    </h1>

                    {/* Location */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '16px 0',
                        cursor: 'pointer',
                        borderBottom: '1px solid #eff3f4' // subtle divider
                    }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '15px' }}>位置</div>
                            <div style={{ color: '#536471', fontSize: '15px' }}>United States</div>
                        </div>
                        <ChevronRight size={20} style={{ color: '#536471' }} />
                    </div>

                    {/* Age Range */}
                    <div style={{ padding: '24px 0', borderBottom: '1px solid #eff3f4' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <div style={{ fontWeight: 700, fontSize: '15px' }}>年龄范围</div>
                            <div style={{ fontWeight: 700, fontSize: '15px' }}>{ageRange[0]} - {ageRange[1]}+</div>
                        </div>

                        {/* Simple Visual Slider Representation */}
                        <div style={{
                            position: 'relative',
                            height: '4px',
                            backgroundColor: '#cfd9de',
                            borderRadius: '2px',
                            marginTop: '16px',
                            marginBottom: '8px'
                        }}>
                            <div style={{
                                position: 'absolute',
                                left: '0%',
                                right: '0%',
                                top: 0,
                                bottom: 0,
                                backgroundColor: '#1d9bf0',
                                borderRadius: '2px'
                            }}></div>
                            <div style={{
                                position: 'absolute',
                                left: '0%',
                                top: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: '16px',
                                height: '16px',
                                backgroundColor: '#1d9bf0',
                                borderRadius: '50%',
                                cursor: 'pointer',
                                boxShadow: '0 0 2px rgba(0,0,0,0.2)'
                            }}></div>
                            <div style={{
                                position: 'absolute',
                                right: '0%',
                                top: '50%',
                                transform: 'translate(50%, -50%)',
                                width: '16px',
                                height: '16px',
                                backgroundColor: '#1d9bf0',
                                borderRadius: '50%',
                                cursor: 'pointer',
                                boxShadow: '0 0 2px rgba(0,0,0,0.2)'
                            }}></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#536471', fontSize: '13px' }}>
                            <span>18</span>
                            <span>55+</span>
                        </div>
                    </div>

                    {/* Gender */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '16px 0',
                        cursor: 'pointer'
                    }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '15px' }}>性别</div>
                            <div style={{ color: '#536471', fontSize: '15px' }}>任何性别</div>
                        </div>
                        <ChevronRight size={20} style={{ color: '#536471' }} />
                    </div>

                </div>

                {/* Footer */}
                <div style={{
                    padding: '24px 32px',
                    display: 'flex',
                    justifyContent: 'center'
                }}>
                    <button style={{
                        backgroundColor: '#0f1419',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '9999px',
                        padding: '0 32px',
                        height: '48px',
                        fontSize: '15px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        width: '100%',
                        transition: 'background-color 0.2s'
                    }} className="hover:bg-neutral-800 transition-colors">
                        下一步
                    </button>
                </div>
            </div>
        </div>
    );
}
