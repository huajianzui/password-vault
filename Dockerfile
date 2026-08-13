# CipherVault Dockerfile - Ultra Lightweight Nginx Static Server
FROM nginx:alpine

# Copy all static assets to default Nginx html dir
COPY . /usr/share/nginx/html/

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
