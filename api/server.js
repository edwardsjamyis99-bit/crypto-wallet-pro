const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory storage (use database in production)
const users = new Map();
const wallets = new Map();
const transactions = new Map();

// Generate random wallet address
function generateWalletAddress(chain) {
  const prefixes = {
    ETH: '0x',
    BTC: 'bc1',
    SOL: 'Sol',
    BSC: '0x',
    TRX: 'T',
    MATIC: '0x',
    AVAX: '0x'
  };
  const prefix = prefixes[chain] || '0x';
  const randomPart = Math.random().toString(36).substring(2, 42);
  return prefix + randomPart;
}

// Create user
app.post('/api/user/create', (req, res) => {
  const userId = uuidv4();
  const user = {
    id: userId,
    name: req.body.name || `User_${userId.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    wallets: []
  };
  users.set(userId, user);
  res.json({ userId, user });
});

// Create wallet
app.post('/api/wallet/create', (req, res) => {
  const { userId, chain, name, network } = req.body;
  const walletId = uuidv4();
  const wallet = {
    id: walletId,
    userId,
    chain,
    name: name || `${chain} Wallet`,
    network: network || 'Mainnet',
    address: generateWalletAddress(chain),
    privateKey: `0x${Math.random().toString(36).substring(2, 66)}`,
    balance: Math.random() * 10,
    transactions: [],
    createdAt: new Date().toISOString()
  };
  const user = users.get(userId);
  if (user) {
    user.wallets.push(walletId);
    wallets.set(walletId, wallet);
    res.json({ success: true, wallet });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Get wallets
app.get('/api/wallets/:userId', (req, res) => {
  const { userId } = req.params;
  const user = users.get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const userWallets = user.wallets.map(walletId => wallets.get(walletId));
  res.json(userWallets);
});

// Get supported chains
app.get('/api/chains', (req, res) => {
  const chains = [
    { id: 'ETH', name: 'Ethereum', symbol: 'ETH', icon: '🔷', network: 'ERC20' },
    { id: 'BTC', name: 'Bitcoin', symbol: 'BTC', icon: '₿', network: 'BTC' },
    { id: 'SOL', name: 'Solana', symbol: 'SOL', icon: '🟣', network: 'Solana' },
    { id: 'BSC', name: 'Binance Smart Chain', symbol: 'BNB', icon: '🟡', network: 'BEP20' },
    { id: 'TRX', name: 'Tron', symbol: 'TRX', icon: '🔴', network: 'TRC20' },
    { id: 'MATIC', name: 'Polygon', symbol: 'MATIC', icon: '🟣', network: 'Polygon' },
    { id: 'AVAX', name: 'Avalanche', symbol: 'AVAX', icon: '🔺', network: 'AVAX' }
  ];
  res.json(chains);
});

// Get rates
app.get('/api/rates/all', async (req, res) => {
  try {
    const chains = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'tron', 'matic-network', 'avalanche-2'];
    const currencies = ['usd', 'eur', 'gbp', 'jpy', 'cny', 'inr', 'brl'];
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${chains.join(',')}&vs_currencies=${currencies.join(',')}`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch rates' });
  }
});

// Send transaction
app.post('/api/transaction/send', async (req, res) => {
  try {
    const { fromWalletId, toAddress, amount, currency, note, speed = 'normal' } = req.body;
    const wallet = wallets.get(fromWalletId);
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    
    const rateResponse = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${wallet.chain.toLowerCase()}&vs_currencies=usd`
    );
    const rate = rateResponse.data[wallet.chain.toLowerCase()]?.usd || 50000;
    
    const fees = { slow: amount * 0.001, normal: amount * 0.002, fast: amount * 0.005 };
    const fee = fees[speed];
    const totalAmount = amount + fee;
    
    if (wallet.balance < totalAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const transactionId = uuidv4();
    const transaction = {
      id: transactionId,
      type: 'send',
      fromWallet: wallet.address,
      toAddress,
      amount,
      fee,
      total: totalAmount,
      currency: wallet.chain,
      fiatValue: amount * rate,
      fiatCurrency: 'USD',
      rate,
      note: note || '',
      status: 'confirmed',
      txHash: `0x${Math.random().toString(36).substring(2, 66)}`,
      timestamp: new Date().toISOString(),
      confirmations: 12,
      blockNumber: Math.floor(Math.random() * 10000000),
      gasPrice: `${(Math.random() * 100).toFixed(2)} Gwei`,
      gasLimit: 21000
    };
    
    wallet.balance -= totalAmount;
    wallet.transactions.push(transactionId);
    transactions.set(transactionId, transaction);
    
    res.json({ success: true, transaction, receiptUrl: `/api/receipt/${transactionId}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Transaction failed' });
  }
});

// Receive transaction
app.post('/api/transaction/receive', (req, res) => {
  try {
    const { walletId, fromAddress, amount, currency, note } = req.body;
    const wallet = wallets.get(walletId);
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    
    const transactionId = uuidv4();
    const transaction = {
      id: transactionId,
      type: 'receive',
      fromAddress,
      toWallet: wallet.address,
      amount,
      currency: wallet.chain,
      note: note || '',
      status: 'confirmed',
      txHash: `0x${Math.random().toString(36).substring(2, 66)}`,
      timestamp: new Date().toISOString(),
      confirmations: 12
    };
    
    wallet.balance += amount;
    wallet.transactions.push(transactionId);
    transactions.set(transactionId, transaction);
    
    res.json({ success: true, transaction });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record receipt' });
  }
});

// Get transactions
app.get('/api/transactions/:walletId', (req, res) => {
  const { walletId } = req.params;
  const wallet = wallets.get(walletId);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }
  const walletTransactions = wallet.transactions.map(txId => transactions.get(txId));
  res.json(walletTransactions);
});

// Generate PDF receipt
app.get('/api/receipt/:transactionId', async (req, res) => {
  const { transactionId } = req.params;
  const transaction = transactions.get(transactionId);
  
  if (!transaction) {
    return res.status(404).json({ error: 'Receipt not found' });
  }
  
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=receipt_${transactionId}.pdf`);
  doc.pipe(res);
  
  // Generate PDF content
  doc.fontSize(24).font('Helvetica-Bold').text('CRYPTO TRANSACTION RECEIPT', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).font('Helvetica');
  doc.fillColor('green').text('✓ CONFIRMED', { align: 'center' });
  doc.fillColor('black');
  doc.moveDown();
  
  doc.fontSize(14).font('Helvetica-Bold').text('Transaction Details', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Transaction Hash: ${transaction.txHash}`);
  doc.text(`Status: ${transaction.status.toUpperCase()}`);
  doc.text(`Timestamp: ${new Date(transaction.timestamp).toLocaleString()}`);
  doc.text(`Confirmations: ${transaction.confirmations || 0}`);
  doc.moveDown();
  
  doc.fontSize(14).font('Helvetica-Bold').text('Amount Details', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Amount: ${transaction.amount} ${transaction.currency}`);
  if (transaction.fiatValue) {
    doc.text(`Fiat Value: $${transaction.fiatValue.toFixed(2)} USD`);
  }
  if (transaction.fee) {
    doc.text(`Network Fee: ${transaction.fee} ${transaction.currency}`);
    doc.text(`Total: ${transaction.total} ${transaction.currency}`);
  }
  doc.moveDown();
  
  doc.fontSize(14).font('Helvetica-Bold').text('Address Details', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica');
  if (transaction.type === 'send') {
    doc.text(`From: ${transaction.fromWallet}`);
    doc.text(`To: ${transaction.toAddress}`);
  } else {
    doc.text(`From: ${transaction.fromAddress}`);
    doc.text(`To: ${transaction.toWallet}`);
  }
  doc.moveDown();
  
  doc.fontSize(8).text('This is an official transaction receipt. Verify on blockchain explorer.', { align: 'center' });
  doc.text(`Receipt ID: ${transaction.id}`, { align: 'center' });
  
  doc.end();
});

module.exports = app;
