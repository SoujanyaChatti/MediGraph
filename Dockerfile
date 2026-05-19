FROM python:3.12-slim

WORKDIR /app

RUN pip install jaclang byllm python-dotenv requests

COPY . .

RUN jac check main.jac || true

RUN apt-get update && apt-get install -y nodejs npm && \
    cd frontend && npm install && npm run build

EXPOSE 10000

CMD ["jac", "start", "main.jac", "-p", "10000"]
