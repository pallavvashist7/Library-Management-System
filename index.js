require("dotenv").config();

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET missing in .env");
  process.exit(1);
}

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// ✅ ADDED
const isProd = process.env.NODE_ENV === "production";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* =========================
   AUTH MIDDLEWARE
========================= */

function authenticateToken(req, res, next) {
  const token = req.cookies.token;

  if (!token)
    return res.redirect("/signin?error=Please sign in first");

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.redirect("/signin?error=Session expired");
  }
}

app.use((req, res, next) => {
  const token = req.cookies.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.locals.isLoggedIn = true;
      res.locals.username = decoded.username;
    } catch {
      res.locals.isLoggedIn = false;
    }
  } else {
    res.locals.isLoggedIn = false;
  }

  next();
});

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.render("index", { pageTitle: "Home" });
});

/* =========================
   SIGN IN
========================= */

app.get("/signin", (req, res) => {
  res.render("signin", {
    pageTitle: "Sign In",
    error: req.query.error || null
  });
});

app.post("/signin", async (req, res) => {
  const { username, password } = req.body;
  let connection;

  try {
    connection = await pool.getConnection();

    const [users] = await connection.query(
      "SELECT * FROM users WHERE username=?",
      [username]
    );

    if (users.length === 0) {
      return res.render("signin", {
        pageTitle: "Sign In",
        error: "Invalid username or password"
      });
    }

    const user = users[0];

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.render("signin", {
        pageTitle: "Sign In",
        error: "Invalid username or password"
      });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // ✅ FIXED COOKIE
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax"
    });

    res.redirect("/books");

  } catch (err) {
    console.error(err);

    res.render("signin", {
      pageTitle: "Sign In",
      error: "Login error"
    });

  } finally {
    if (connection) connection.release();
  }
});

/* =========================
   SIGN UP
========================= */

app.get("/signup", (req, res) => {
  res.render("signup", {
    pageTitle: "Sign Up",
    error: null
  });
});

app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;
  let connection;

  try {
    connection = await pool.getConnection();

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await connection.query(
      "INSERT INTO users (username,email,password) VALUES (?,?,?)",
      [username, email, hashedPassword]
    );

    const token = jwt.sign(
      { id: result.insertId, username: username },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    // ✅ FIXED COOKIE
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax"
    });

    res.redirect("/books");

  } catch (err) {
    console.error(err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.render("signup", {
        pageTitle: "Sign Up",
        error: "Username or Email already exists"
      });
    }

    res.render("signup", {
      pageTitle: "Sign Up",
      error: err.message || "Something went wrong"
    });

  } finally {
    if (connection) connection.release();
  }
});

/* =========================
   LOGOUT
========================= */

app.get("/logout", (req, res) => {

  // ✅ FIXED COOKIE CLEAR
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax"
  });

  res.redirect("/");
});

/* =========================
   BOOKS (PROTECTED)
========================= */

app.get("/books", authenticateToken, async (req, res) => {

  let connection;

  try {
    connection = await pool.getConnection();

    const [books] = await connection.query("SELECT * FROM books");

    res.render("books", {
      pageTitle: "Books",
      books
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading books");

  } finally {
    if (connection) connection.release();
  }
});

/* =========================
   SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});