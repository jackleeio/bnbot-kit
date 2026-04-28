/**
 * ReportService
 * Generates and sends periodic reports to the backend.
 */

import { commandService } from './commandService';

export interface ReportData {
  // Time period
  periodStart: string;
  periodEnd: string;

  // Statistics
  tweetsScanned: number;
  repliesPosted: number;
  repliesSkipped: number;

  // Recent replies
  replies: Array<{
    authorHandle: string;
    tweetPreview: string;
    replyContent: string;
    score: number;
    timestamp: string;
  }>;
}

class ReportService {
  private reportData: Partial<ReportData> = {};
  private repliesBuffer: ReportData['replies'] = [];
  private periodStart: Date | null = null;
  private readonly MAX_REPLIES_IN_REPORT = 10;

  /**
   * Start a new reporting period
   */
  startPeriod(): void {
    this.periodStart = new Date();
    this.reportData = {
      tweetsScanned: 0,
      repliesPosted: 0,
      repliesSkipped: 0
    };
    this.repliesBuffer = [];
    console.log('[ReportService] Started new reporting period');
  }

  /**
   * Record a tweet scan
   */
  recordScan(): void {
    if (this.reportData.tweetsScanned !== undefined) {
      this.reportData.tweetsScanned++;
    }
  }

  /**
   * Record a posted reply
   */
  recordReply(
    authorHandle: string,
    tweetPreview: string,
    replyContent: string,
    score: number
  ): void {
    if (this.reportData.repliesPosted !== undefined) {
      this.reportData.repliesPosted++;
    }

    this.repliesBuffer.push({
      authorHandle,
      tweetPreview: tweetPreview.substring(0, 100),
      replyContent: replyContent.substring(0, 100),
      score,
      timestamp: new Date().toISOString()
    });

    // Keep only recent replies
    if (this.repliesBuffer.length > this.MAX_REPLIES_IN_REPORT) {
      this.repliesBuffer.shift();
    }
  }

  /**
   * Record a skipped reply
   */
  recordSkip(): void {
    if (this.reportData.repliesSkipped !== undefined) {
      this.reportData.repliesSkipped++;
    }
  }

  /**
   * Generate the current report
   */
  generateReport(): ReportData {
    const now = new Date();

    return {
      periodStart: this.periodStart?.toISOString() || now.toISOString(),
      periodEnd: now.toISOString(),
      tweetsScanned: this.reportData.tweetsScanned || 0,
      repliesPosted: this.reportData.repliesPosted || 0,
      repliesSkipped: this.reportData.repliesSkipped || 0,
      replies: [...this.repliesBuffer]
    };
  }

  /**
   * Send report to backend.
   */
  sendReport(): void {
    if (!commandService.isConnected()) {
      console.warn('[ReportService] CommandService not connected, cannot send report');
      return;
    }

    const report = this.generateReport();
    commandService.sendReport(report);
    console.log('[ReportService] Report sent:', report);

    // Start a new period after sending
    this.startPeriod();
  }

  /**
   * Get current statistics without sending
   */
  getStats(): Partial<ReportData> {
    return {
      tweetsScanned: this.reportData.tweetsScanned,
      repliesPosted: this.reportData.repliesPosted,
      repliesSkipped: this.reportData.repliesSkipped
    };
  }

  /**
   * Reset all data
   */
  reset(): void {
    this.reportData = {};
    this.repliesBuffer = [];
    this.periodStart = null;
  }
}

// Export singleton instance
export const reportService = new ReportService();
