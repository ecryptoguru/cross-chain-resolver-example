/**
 * Dynamic Auction Service - 1inch Fusion+ Style
 * Implements dynamic pricing curves and auction mechanics for cross-chain transfers
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

export interface AuctionPoint {
  delay: number; // seconds relative to previous point
  coefficient: number; // rate bump (10_000_000 = 100%)
}

export interface AuctionConfig {
  duration: number; // auction duration in seconds
  initialRateBump: number; // initial rate bump (50000 = 5%)
  points: AuctionPoint[]; // price curve points
  gasBumpEstimate: number; // gas cost coverage
  gasPriceEstimate: number; // estimated gas price in Gwei
}

export interface CrossChainAuctionParams {
  fromChain: 'NEAR' | 'ETH';
  toChain: 'ETH' | 'NEAR';
  fromAmount: string;
  baseExchangeRate: number; // base rate (e.g., 1 NEAR = 0.001 ETH)
  startTime: number; // unix timestamp
  orderId: string;
}

export interface AuctionResult {
  currentRate: number;
  outputAmount: string;
  feeAmount: string;
  totalCost: string;
  timeRemaining: number;
  isExpired: boolean;
}

export class DynamicAuctionService {
  private readonly defaultConfig: AuctionConfig = {
    duration: 180, // 3 minutes
    initialRateBump: 50000, // 5% initial bump
    points: [
      { delay: 30, coefficient: 40000 }, // 4% after 30s
      { delay: 60, coefficient: 30000 }, // 3% after 90s total
      { delay: 90, coefficient: 20000 }  // 2% after 180s total
    ],
    gasBumpEstimate: 10000, // 1% for gas costs
    gasPriceEstimate: 20 // 20 Gwei
  };

  /**
   * Create a new cross-chain auction
   */
  createAuction(params: CrossChainAuctionParams, config?: Partial<AuctionConfig>): string {
    const auctionConfig = { ...this.defaultConfig, ...config };
    
    logger.info('Creating dynamic auction for cross-chain transfer', {
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromAmount: params.fromAmount,
      baseRate: params.baseExchangeRate,
      duration: auctionConfig.duration,
      orderId: params.orderId
    });

    // Store auction data (in production, use persistent storage)
    const auctionData = {
      ...params,
      config: auctionConfig,
      createdAt: Date.now()
    };

    // Return auction ID for tracking
    return `auction_${params.orderId}_${Date.now()}`;
  }

  /**
   * Calculate current auction rate and output amount
   */
  calculateCurrentRate(
    params: CrossChainAuctionParams, 
    config?: Partial<AuctionConfig>
  ): AuctionResult {
    const auctionConfig = { ...this.defaultConfig, ...config };
    const currentTime = Math.floor(Date.now() / 1000);
    const elapsedTime = currentTime - params.startTime;
    
    // Check if auction is expired
    if (elapsedTime >= auctionConfig.duration) {
      return this.getExpiredAuctionResult(params, auctionConfig);
    }

    // Calculate rate bump based on time and curve
    const rateBump = this.calculateRateBump(elapsedTime, auctionConfig);
    
    // Apply rate bump to base exchange rate
    const adjustedRate = params.baseExchangeRate * (1 + rateBump / 10_000_000);
    
    // Calculate output amount
    const fromAmountBN = ethers.BigNumber.from(params.fromAmount);
    const outputAmount = this.calculateOutputAmount(fromAmountBN, adjustedRate, params);
    
    // Calculate fees (1% market maker fee)
    const feeAmount = outputAmount.div(100); // 1% fee
    const totalCost = outputAmount.add(feeAmount);

    logger.debug('Auction rate calculation', {
      orderId: params.orderId,
      elapsedTime,
      rateBump,
      adjustedRate,
      outputAmount: ethers.utils.formatUnits(outputAmount, params.toChain === 'ETH' ? 18 : 24),
      feeAmount: ethers.utils.formatUnits(feeAmount, params.toChain === 'ETH' ? 18 : 24)
    });

    return {
      currentRate: adjustedRate,
      outputAmount: outputAmount.toString(),
      feeAmount: feeAmount.toString(),
      totalCost: totalCost.toString(),
      timeRemaining: auctionConfig.duration - elapsedTime,
      isExpired: false
    };
  }

  /**
   * Calculate rate bump based on auction curve
   */
  private calculateRateBump(elapsedTime: number, config: AuctionConfig): number {
    // Start with initial rate bump
    let currentRateBump = config.initialRateBump;
    let timeAccumulator = 0;

    // Apply curve points
    for (const point of config.points) {
      timeAccumulator += point.delay;
      
      if (elapsedTime >= timeAccumulator) {
        currentRateBump = point.coefficient;
      } else {
        // Interpolate between current and next point
        const prevTime = timeAccumulator - point.delay;
        const progress = (elapsedTime - prevTime) / point.delay;
        const prevRateBump = currentRateBump;
        currentRateBump = prevRateBump + (point.coefficient - prevRateBump) * progress;
        break;
      }
    }

    // Add gas cost bump
    currentRateBump += config.gasBumpEstimate;

    return currentRateBump;
  }

  /**
   * Calculate output amount based on exchange rate and direction
   */
  private calculateOutputAmount(
    fromAmount: ethers.BigNumber, 
    rate: number, 
    params: CrossChainAuctionParams
  ): ethers.BigNumber {
    if (params.fromChain === 'NEAR' && params.toChain === 'ETH') {
      // NEAR (24 decimals) → ETH (18 decimals)
      // Apply rate and adjust decimals
      const rateMultiplier = ethers.BigNumber.from(Math.floor(rate * 1_000_000));
      return fromAmount.mul(rateMultiplier).div(1_000_000_000_000); // Adjust for decimal difference
    } else {
      // ETH (18 decimals) → NEAR (24 decimals)  
      // Apply rate and adjust decimals
      const rateMultiplier = ethers.BigNumber.from(Math.floor(rate * 1_000_000));
      return fromAmount.mul(rateMultiplier).mul(1_000_000); // Adjust for decimal difference
    }
  }

  /**
   * Get result for expired auction
   */
  private getExpiredAuctionResult(
    params: CrossChainAuctionParams, 
    config: AuctionConfig
  ): AuctionResult {
    // Use final rate (last point + gas bump)
    const finalPoint = config.points[config.points.length - 1];
    const finalRate = params.baseExchangeRate * (1 + (finalPoint.coefficient + config.gasBumpEstimate) / 10_000_000);
    
    const fromAmountBN = ethers.BigNumber.from(params.fromAmount);
    const outputAmount = this.calculateOutputAmount(fromAmountBN, finalRate, params);
    const feeAmount = outputAmount.div(100);
    const totalCost = outputAmount.add(feeAmount);

    return {
      currentRate: finalRate,
      outputAmount: outputAmount.toString(),
      feeAmount: feeAmount.toString(),
      totalCost: totalCost.toString(),
      timeRemaining: 0,
      isExpired: true
    };
  }

  /**
   * Get optimal execution time for market makers
   */
  getOptimalExecutionTime(
    params: CrossChainAuctionParams,
    targetProfitBps: number = 50 // 0.5% target profit
  ): number {
    const config = this.defaultConfig;
    let optimalTime = 0;
    let bestProfitMargin = 0;

    // Simulate different execution times
    for (let time = 0; time < config.duration; time += 10) {
      const rateBump = this.calculateRateBump(time, config);
      const adjustedRate = params.baseExchangeRate * (1 + rateBump / 10_000_000);
      
      // Calculate profit margin (difference between market rate and auction rate)
      const profitMargin = (params.baseExchangeRate - adjustedRate) / params.baseExchangeRate * 10000; // in bps
      
      if (profitMargin >= targetProfitBps && profitMargin > bestProfitMargin) {
        bestProfitMargin = profitMargin;
        optimalTime = time;
      }
    }

    logger.debug('Optimal execution analysis', {
      orderId: params.orderId,
      optimalTime,
      bestProfitMargin,
      targetProfitBps
    });

    return params.startTime + optimalTime;
  }

  /**
   * Create auction configuration for different market conditions
   */
  createMarketConfig(volatility: 'low' | 'medium' | 'high'): AuctionConfig {
    switch (volatility) {
      case 'low':
        return {
          duration: 300, // 5 minutes for stable markets
          initialRateBump: 30000, // 3% initial
          points: [
            { delay: 60, coefficient: 25000 },
            { delay: 120, coefficient: 20000 },
            { delay: 120, coefficient: 15000 }
          ],
          gasBumpEstimate: 5000, // 0.5%
          gasPriceEstimate: 15
        };
      
      case 'medium':
        return this.defaultConfig;
      
      case 'high':
        return {
          duration: 120, // 2 minutes for volatile markets
          initialRateBump: 80000, // 8% initial
          points: [
            { delay: 20, coefficient: 60000 },
            { delay: 40, coefficient: 40000 },
            { delay: 60, coefficient: 30000 }
          ],
          gasBumpEstimate: 20000, // 2%
          gasPriceEstimate: 50
        };
    }
  }
}
