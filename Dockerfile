FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install jaclang==0.10.2 byllm==0.4.20 python-dotenv requests

# Copy project
COPY . .

# Pre-compile Jac during build so startup is instant
RUN jac check main.jac || true

# Install Node for frontend
RUN apt-get update && apt-get install -y nodejs npm
RUN cd frontend && npm install && npm run build

EXPOSE 10000

CMD ["jac", "start", "main.jac", "-p", "10000"]
