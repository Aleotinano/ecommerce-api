# Ecommerce API

Backend API para una plataforma de e-commerce, desarrollada con Node.js y orientada a buenas prácticas y uso real en producción.

---

## 🚀 Tech Stack

- **Node.js**
- **Express**
- **PostgreSQL**
- **Prisma ORM**

---

## 📁 Funcionalidades

### 👤 Users
- Registro y autenticación de usuarios (login / register)
- Hash de contraseñas con argon2
- Manejo de roles (USER / ADMIN)
- Protección de endpoints según rol
- CRUD de usuarios

### 🛒 Products
- CRUD de productos
- Validaciones de datos de entrada
- Asociación de productos con usuarios (admin)

### 🛍️ Cart
- Carrito de compras por usuario
- Gestión de items del carrito
- Relación usuario ↔ carrito ↔ productos
- Actualización de cantidades y eliminación de items

### 🧪 Validaciones
- Validación de payloads HTTP con schemas
- Manejo de errores de validación
- Respuestas HTTP consistentes

---

## 🧩 Middlewares

- **JWT Authentication**  
  Protección de rutas privadas mediante JSON Web Tokens.

- **Role-based Access Control (RBAC)**  
  Autorización de endpoints según rol del usuario (USER / ADMIN).

- **CORS**  
  Configuración de acceso controlado entre clientes y servidor.



