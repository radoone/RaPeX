# Safety Gate API Setup Guide

## Overview
This guide explains how to set up secure authentication between the Shopify app and Firebase Functions for the Safety Gate product safety checking system.

## Prerequisites
- Firebase project with Functions deployed
- Shopify app with admin access

## Step 1: Generate API Key
Generate a secure API key for authentication:

```bash
# Generate a random 32-character API key
openssl rand -hex 32
```

## Step 2: Set Firebase Environment Variable
Set the API key in your Firebase Functions environment:

```bash
cd firebase/functions
firebase functions:config:set safety_gate.api_key="YOUR_GENERATED_API_KEY"
```

Or set it directly in the Firebase Console:
1. Go to Firebase Console > Functions > Configuration
2. Add environment variable: `SAFETY_GATE_API_KEY`
3. Set value to your generated API key

## Step 3: Set Shopify App Environment Variable
Create a `.env` file in your Shopify app root directory:

```bash
# .env
SAFETY_GATE_API_KEY=your-generated-api-key-here
FIREBASE_FUNCTIONS_BASE_URL=https://europe-west1-rapex-99a2c.cloudfunctions.net
```

## Step 4: Deploy Firebase Functions
Deploy the updated Firebase Functions:

```bash
cd firebase/functions
npm run deploy
```

## Step 5: Restart Shopify App
Restart your Shopify app to load the new environment variables.

## Security Notes
- Never commit API keys to version control
- Use different API keys for development and production
- Regularly rotate API keys
- Monitor Firebase Functions logs for unauthorized access attempts

## Testing
Test the authentication by making a request to the API:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"name":"Test Product","category":"toys","description":"Test description"}' \
  https://europe-west1-{project-id}.cloudfunctions.net/checkProductSafetyAPI
```

## Troubleshooting
- **403 Forbidden**: Check if API key is correctly set in both Firebase and Shopify app
- **401 Unauthorized**: Verify API key format and ensure it matches exactly
- **Environment variables not loading**: Restart the Shopify app after setting environment variables
