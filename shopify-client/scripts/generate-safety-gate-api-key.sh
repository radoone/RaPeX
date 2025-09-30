#!/bin/bash

# Generate a secure API key for Safety Gate API authentication
echo "Generating secure API key for Safety Gate API..."

# Generate 32-character hex string
API_KEY=$(openssl rand -hex 32)

echo "Generated API Key: $API_KEY"
echo ""
echo "Add this to your .env file:"
echo "SAFETY_GATE_API_KEY=$API_KEY"
echo ""
echo "And set it in Firebase Functions environment:"
echo "firebase functions:config:set safety_gate.api_key=\"$API_KEY\""
echo ""
echo "⚠️  Keep this key secure and never commit it to version control!"
