FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir pymupdf==1.28.2
COPY server.py indexar.py ./
ENV PORT=3100 DADOS=/dados PYTHONUNBUFFERED=1
EXPOSE 3100
CMD ["python", "server.py"]
