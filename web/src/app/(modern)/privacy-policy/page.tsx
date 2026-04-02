'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Navbar, Footer } from '@/components/homepage';
import ClassicLayout from '@/layouts/classic/layout';

export default function PrivacyPolicyPage() {
    return (
        <ClassicLayout contentClassName="!p-0">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="min-h-screen bg-white text-slate-900 selection:bg-gold-400/30 font-sans"
            >
                <Navbar />

                <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
                    <div className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-600 prose-li:text-slate-600 prose-strong:text-slate-900 prose-a:text-gold-600 hover:prose-a:text-gold-500">
                        <h1>Privacy Policy for BNBOT AI Chrome Extension</h1>
                        <p className="lead">Last Updated: December 24, 2025</p>

                        <h2>Introduction</h2>
                        <p>
                            BNBOT AI ("we", "our", or "the Extension") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our Chrome extension.
                        </p>

                        <h2>Information We Collect</h2>

                        <h3>1. Google Account Information</h3>
                        <p>When you sign in using Google OAuth, we receive:</p>
                        <ul>
                            <li>Your Google account email address</li>
                            <li>Your display name</li>
                            <li>Your profile picture URL</li>
                        </ul>
                        <p>This information is used solely for authentication and personalization within the extension.</p>

                        <h3>2. Twitter/X Page Content</h3>
                        <p>The extension reads content from Twitter/X pages you visit to provide:</p>
                        <ul>
                            <li>Tweet analysis and AI-powered responses</li>
                            <li>Crypto token analysis from tweets</li>
                            <li>Bounty task detection</li>
                        </ul>
                        <p><strong>We do not store or transmit your Twitter/X browsing history to external servers.</strong></p>

                        <h3>3. Local Storage Data</h3>
                        <p>We store the following data locally in your browser:</p>
                        <ul>
                            <li>Your login session information</li>
                            <li>User preferences and settings</li>
                            <li>Chat history with the AI assistant</li>
                            <li>Credits balance</li>
                        </ul>

                        <h2>How We Use Your Information</h2>
                        <ul>
                            <li><strong>Authentication</strong>: To verify your identity and provide personalized features</li>
                            <li><strong>AI Features</strong>: To analyze tweets and generate helpful responses using Google Gemini AI</li>
                            <li><strong>Credits System</strong>: To track your usage of AI features</li>
                        </ul>

                        <h2>Third-Party Services</h2>

                        <h3>Google Gemini AI</h3>
                        <p>
                            We use Google Gemini AI to power our chat and analysis features. When you use these features, the content you submit is processed by Google's AI services according to <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google's Privacy Policy</a>.
                        </p>

                        <h3>Google OAuth</h3>
                        <p>
                            We use Google OAuth for secure authentication. Your Google credentials are never stored by our extension.
                        </p>

                        <h2>Data Security</h2>
                        <ul>
                            <li>All authentication is handled through secure Google OAuth</li>
                            <li>We do not store your passwords</li>
                            <li>Local data is stored using Chrome's secure storage API</li>
                            <li>We do not sell or share your personal information with third parties</li>
                        </ul>

                        <h2>Data Retention</h2>
                        <ul>
                            <li>Session data is retained until you log out</li>
                            <li>Chat history is stored locally and can be cleared at any time</li>
                            <li>You can remove all extension data by uninstalling the extension</li>
                        </ul>

                        <h2>Your Rights</h2>
                        <p>You have the right to:</p>
                        <ul>
                            <li>Access the personal information we hold about you</li>
                            <li>Request deletion of your data by uninstalling the extension</li>
                            <li>Opt out of using the extension at any time</li>
                        </ul>

                        <h2>Children's Privacy</h2>
                        <p>
                            This extension is not intended for use by children under 13 years of age. We do not knowingly collect personal information from children.
                        </p>

                        <h2>Changes to This Policy</h2>
                        <p>
                            We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last Updated" date at the top of this policy.
                        </p>

                        <h2>Contact Us</h2>
                        <p>If you have any questions about this Privacy Policy, please contact us at:</p>
                        <p>
                            <strong>Email</strong>: support@bnbot.ai
                        </p>

                        <hr className="my-8 border-slate-200" />

                        <p className="text-sm text-slate-500 italic">
                            This extension is not affiliated with Twitter/X or Google. Twitter and X are trademarks of X Corp. Google is a trademark of Google LLC.
                        </p>
                    </div>
                </main>

                <Footer />
            </motion.div>
        </ClassicLayout>
    );
}
