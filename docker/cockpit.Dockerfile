# Cockpit Streamlit : Python 3.12, lecture Notion avec repli sur data/store monté en volume.
FROM python:3.12-slim
WORKDIR /app
COPY cockpit/requirements.txt ./cockpit/requirements.txt
RUN pip install --no-cache-dir -r cockpit/requirements.txt
COPY cockpit ./cockpit
COPY .streamlit ./.streamlit
EXPOSE 8501
CMD ["streamlit", "run", "cockpit/app.py", "--server.port", "8501", "--server.address", "0.0.0.0"]
