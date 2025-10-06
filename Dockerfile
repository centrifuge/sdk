FROM node:22-slim

ENV FOUNDRY_VERSION=1.3.2

RUN corepack enable && corepack prepare yarn@4.5.0 --activate

RUN apt-get update && apt-get install -y curl ca-certificates git bash \
 && rm -rf /var/lib/apt/lists/*

RUN curl -L https://foundry.paradigm.xyz | bash \
 && /root/.foundry/bin/foundryup

ENV PATH="/root/.foundry/bin:${PATH}"

CMD ["sh", "-c", "anvil \
  --fork-url https://eth-sepolia.api.onfinality.io/rpc?apikey=$API_KEY \
  --auto-impersonate \
  --fork-block-number $BLOCK_NUMBER \
  --fork-chain-id $CHAIN_NUMBER \
  --host 0.0.0.0 \
  --port 8545"]
