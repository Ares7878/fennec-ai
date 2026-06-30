FROM node:20-alpine

# Définir le dossier de travail
WORKDIR /app

# Copier les fichiers package.json
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier tout le code source
COPY . .

# Construire le projet TypeScript
RUN npm run build

# Lancer l'application
CMD ["npm", "start"]
