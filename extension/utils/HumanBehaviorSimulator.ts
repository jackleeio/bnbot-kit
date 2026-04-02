/**
 * Human Behavior Simulator
 * Adds random variations to make actions appear human-like and avoid detection
 */

export class HumanBehaviorSimulator {
  /**
   * Random delay within a range
   */
  static async randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Add jitter to a base value (percentage-based variation)
   * @param baseMs Base value in milliseconds
   * @param jitterPercent Percentage of jitter (0.2 = 20%)
   * @returns Value with random jitter applied
   */
  static addJitter(baseMs: number, jitterPercent: number = 0.2): number {
    const jitter = baseMs * jitterPercent;
    const variation = (Math.random() * 2 - 1) * jitter; // -jitter to +jitter
    return Math.floor(baseMs + variation);
  }

  /**
   * Simulate reading pause based on content length
   * Assumes average reading speed of ~200-250 words per minute
   * @param contentLength Number of characters in content
   */
  static async readingPause(contentLength: number): Promise<void> {
    // Estimate words (avg 5 chars per word)
    const estimatedWords = contentLength / 5;
    // Reading speed: 200-250 WPM = ~4 words per second
    // Add some variation and minimum time
    const baseReadTimeMs = (estimatedWords / 4) * 1000;
    const readTime = Math.max(1000, this.addJitter(baseReadTimeMs, 0.3));
    return new Promise(resolve => setTimeout(resolve, readTime));
  }

  /**
   * Calculate interval between replies with human-like variation
   */
  static calculateReplyInterval(minSeconds: number, maxSeconds: number): number {
    // Use gaussian-like distribution for more natural timing
    // Center around the middle with tails
    const range = maxSeconds - minSeconds;
    const center = minSeconds + range / 2;

    // Box-Muller transform for gaussian-ish distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const gaussianRandom = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    // Scale to our range (use 1/3 of range as standard deviation)
    const stdDev = range / 6;
    let interval = center + gaussianRandom * stdDev;

    // Clamp to min/max
    interval = Math.max(minSeconds, Math.min(maxSeconds, interval));

    return Math.floor(interval * 1000); // Return in milliseconds
  }

  /**
   * Simulate natural scroll behavior
   * @param targetScroll Target scroll position
   */
  static async naturalScroll(targetScroll: number): Promise<void> {
    const currentScroll = window.scrollY;
    const distance = targetScroll - currentScroll;

    // Add some randomness to scroll behavior
    const scrollVariation = this.addJitter(distance, 0.1);
    const actualTarget = currentScroll + scrollVariation;

    window.scrollTo({
      top: actualTarget,
      behavior: 'smooth'
    });

    // Wait for scroll animation
    await this.randomDelay(300, 600);
  }

  /**
   * Scroll by viewport height with variation
   */
  static async scrollByViewport(): Promise<void> {
    const viewportHeight = window.innerHeight;
    // Scroll 0.7-0.9 of viewport height
    const scrollAmount = viewportHeight * (0.7 + Math.random() * 0.2);

    window.scrollBy({
      top: scrollAmount,
      behavior: 'smooth'
    });

    // Wait for scroll to complete + random pause
    await this.randomDelay(500, 1200);
  }

  /**
   * Simulate micro-pauses between actions (like thinking)
   */
  static async microPause(): Promise<void> {
    await this.randomDelay(200, 800);
  }

  /**
   * Simulate longer pause (like reading or considering)
   */
  static async thinkingPause(): Promise<void> {
    await this.randomDelay(1000, 3000);
  }

  /**
   * Simulate click delay (reaction time)
   */
  static async clickDelay(): Promise<void> {
    await this.randomDelay(100, 400);
  }

  /**
   * Check if we should take a break (for very long sessions)
   * Returns true if a break is recommended
   */
  static shouldTakeBreak(sessionDurationMs: number, repliesPosted: number): boolean {
    // Take a break every 15-25 minutes
    const breakIntervalMs = this.addJitter(20 * 60 * 1000, 0.25);

    // Or every 8-12 replies
    const repliesBeforeBreak = 8 + Math.floor(Math.random() * 5);

    return sessionDurationMs > breakIntervalMs || repliesPosted >= repliesBeforeBreak;
  }

  /**
   * Calculate break duration
   */
  static calculateBreakDuration(): number {
    // 2-5 minute break
    return this.addJitter(3.5 * 60 * 1000, 0.3);
  }

  /**
   * Generate a random session length (for ending sessions naturally)
   */
  static generateSessionLength(): number {
    // 30-60 minutes per session
    const minMinutes = 30;
    const maxMinutes = 60;
    const minutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
    return minutes * 60 * 1000;
  }
}
