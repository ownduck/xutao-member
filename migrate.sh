#!/bin/bash
set -e
cd "$(dirname "$0")"
npm run db:push
npm run db:seed
