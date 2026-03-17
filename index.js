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
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

const fs = require("fs");
async function initDB() {
  try {
    const sql = fs.readFileSync("libdb.sql", "utf8");
    await pool.query(sql);
    console.log("✅ DB initialized");
  } catch (err) {
    console.log("⚠️ DB already exists or skipped");
  }
}
initDB();

app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const userCarts = {};
const previewTokens = {};

let PDFLib;
try {
  PDFLib = require("pdf-lib");
} catch {
  console.warn("pdf-lib not installed");
}


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

function authenticateTokenAjax(req, res, next) {

  const token = req.cookies.token;

  if (!token)
    return res.status(401).json({ error: "Not authenticated" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }

}

app.use((req, res, next) => {

  const token = req.cookies.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      res.locals.isLoggedIn = true;
      res.locals.username = decoded.username;
      res.locals.userId = decoded.id;
    } catch {
      res.locals.isLoggedIn = false;
    }
  } else {
    res.locals.isLoggedIn = false;
  }

  next();

});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF allowed"));
  }
});
app.get("/", (req, res) => {
  res.render("index", {
    pageTitle: "Welcome to Library"
  });

});


app.get("/books", authenticateToken, async (req, res) => {

  let connection;
  const userId = req.user.id;
  const cartCount = userCarts[userId] ? userCarts[userId].length : 0;

  try {

    connection = await pool.getConnection();

    const [pRows] = await connection.query(
      "SELECT book_id FROM purchases WHERE user_id = ?",
      [userId]
    );

    const purchasedIds = pRows.map(p => p.book_id);

    let books = [];

    if (req.query.showall) {

      const [allBooks] = await connection.query(
        "SELECT id,title,author,book_no,description,available_copies,cover_image_url FROM books"
      );

      books = allBooks;

    } else {

      if (purchasedIds.length > 0) {

        const [pb] = await connection.query(
          "SELECT id,title,author,book_no,description,available_copies,cover_image_url FROM books WHERE id IN (?)",
          [purchasedIds]
        );

        books = pb;

      }

    }

    res.render("books", {
      pageTitle: req.query.showall ? "Library" : "Your Books",
      books,
      cartCount,
      purchasedIds,
      showAll: req.query.showall,
      q: req.query.q || "",
      message: req.query.message || null
    });

  } catch (err) {

    console.error(err);
    res.status(500).send("Error loading books");

  } finally {

    if (connection) connection.release();

  }

});
app.get("/books/search", authenticateToken, async (req, res) => {
  const query = req.query.q || "";
  const userId = req.user.id;
  let connection;
  try {

    connection = await pool.getConnection();

    const [books] = await connection.query(
      `SELECT id,title,author,book_no,description,available_copies,cover_image_url
       FROM books
       WHERE title LIKE ? OR author LIKE ?`,
      [`%${query}%`, `%${query}%`]
    );

    const [pRows] = await connection.query(
      "SELECT book_id FROM purchases WHERE user_id = ?",
      [userId]
    );

    const purchasedIds = pRows.map(p => p.book_id);

    const cartCount = userCarts[userId] ? userCarts[userId].length : 0;

    res.render("books", {
      pageTitle: "Search Results",
      books,
      cartCount,
      purchasedIds,
      showAll: true,
      q: query,
      message: null
    });

  } catch (err) {

    console.error(err);
    res.status(500).send("Search error");

  } finally {

    if (connection) connection.release();
  }
});

app.post("/cart/add", authenticateTokenAjax, (req, res) => {

  const { id, title } = req.body;
  const userId = req.user.id;

  const bookId = parseInt(id);

  if (!userCarts[userId]) userCarts[userId] = [];

  const existing = userCarts[userId].find(b => b.id === bookId);

  if (existing) existing.quantity++;
  else userCarts[userId].push({ id: bookId, title, quantity: 1 });

  res.json({
    success: true,
    count: userCarts[userId].length
  });

});

app.post("/cart/remove", authenticateTokenAjax, (req, res) => {

  const userId = req.user.id;
  const { id } = req.body;

  const bookId = parseInt(id);

  userCarts[userId] = userCarts[userId].filter(
    item => item.id !== bookId
  );

  res.json({
    success: true,
    count: userCarts[userId].length
  });

});
app.get("/search-suggest", authenticateToken, async (req, res) => {

  const q = req.query.q || "";

  if (q.length === 0)
    return res.json([]);

  let connection;

  try {

    connection = await pool.getConnection();

    const [rows] = await connection.query(
      `SELECT title 
       FROM books
       WHERE LOWER(title) LIKE LOWER(?)
       ORDER BY title
       LIMIT 5`,
      [`${q}%`]
    );

    res.json(rows);

  } catch (err) {

    console.error("Suggestion error:", err);
    res.json([]);

  } finally {

    if (connection) connection.release();

  }

});
app.post("/checkout/pay", authenticateToken, async (req, res) => {
const userId = req.user.id;
const cartItems = userCarts[userId] || [];
let connection;

try{
connection = await pool.getConnection();

for(const item of cartItems){
await connection.query(
"INSERT INTO purchases (user_id, book_id) VALUES (?, ?)",
[userId, item.id]
);
}
}catch(err){
console.error(err);
}
finally{
if(connection) connection.release();}
userCarts[userId] = [];
res.redirect("/books?message=Payment successful");
});
app.get("/read/:bookId", authenticateToken, async (req, res) => {
  const bookId = req.params.bookId;
  const userId = req.user.id;

  let connection;

  try {

    connection = await pool.getConnection();

    const [rows] = await connection.query(
      "SELECT title, book_content_file FROM books WHERE id = ?",
      [bookId]
    );

    const [purchasedRows] = await connection.query(
      "SELECT * FROM purchases WHERE user_id = ? AND book_id = ?",
      [userId, bookId]
    );

    const purchased = purchasedRows.length > 0;
const token = req.query.t;

let tokenValid = false;

if (token && previewTokens[token]) {

  const info = previewTokens[token];

  if (
    info.bookId === parseInt(bookId) &&
    info.userId === userId &&
    Date.now() < info.expires
  ) {
    tokenValid = true;
  }

}

if (!purchased && !tokenValid) {
  return res.redirect(`/preview/${bookId}`);
}

    const book = rows[0];

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${book.title.replace(/[^a-z0-9]/gi, "_")}.pdf"`
    );

    res.send(book.book_content_file);

  } catch (error) {

    console.error("Error serving book file:", error);
    res.status(500).send("Error retrieving book file.");

  } finally {

    if (connection) connection.release();

  }

});


app.get("/checkout", authenticateToken, async (req, res) => {

const userId = req.user.id;
const cartItems = userCarts[userId] || [];

let connection;

try {

connection = await pool.getConnection();

const bookIds = cartItems.map(item => item.id);

let cartDetails = [];

if (bookIds.length > 0) {

const [books] = await connection.query(
"SELECT id,title,cover_image_url FROM books WHERE id IN (?)",
[bookIds]
);

cartDetails = books.map(book => {

const cartItem = cartItems.find(c => c.id === book.id);

return {
id: book.id,
title: book.title,
cover_image: book.cover_image_url || "/images/default-cover.png",
price: 250,
quantity: cartItem.quantity
};

});

}

res.render("checkout", {
pageTitle: "Checkout",
cart: cartDetails
});

} catch (err) {

console.error(err);
res.status(500).send("Checkout error");

} finally {

if (connection) connection.release();

}

});

app.get("/logout", (req, res) => {

  res.clearCookie("token");
  res.redirect("/");

});

app.get("/signin", (req, res) => {

  res.render("signin", {
    pageTitle: "Sign In",
    error: req.query.error || null,
    message: req.query.message || null
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

    if (users.length === 0)
      return res.render("signin", {
        pageTitle: "Sign In",
        error: "Invalid username or password",
        message: null
      });

    const user = users[0];

    const match = await bcrypt.compare(password, user.password);

    if (!match)
      return res.render("signin", {
        pageTitle: "Sign In",
        error: "Invalid username or password",
        message: null
      });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.cookie("token", token, { httpOnly: true });

    res.redirect("/books");

  } catch {

    res.render("signin", {
      pageTitle: "Sign In",
      error: "Login error",
      message: null
    });

  } finally {

    if (connection) connection.release();

  }

});

app.get("/signup", (req, res) => {

  res.render("signup", {
    pageTitle: "Sign Up",
    error: null
  });

});
////
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

    res.cookie("token", token, { httpOnly: true });

    res.redirect("/books");

  } catch (err) {

    console.error("SIGNUP ERROR:", err); // 🔥 must log

    if (err.code === "ER_DUP_ENTRY") {
      return res.render("signup", {
        pageTitle: "Sign Up",
        error: "Username or Email already exists"
      });
    }

    return res.render("signup", {
      pageTitle: "Sign Up",
      error: err.message || "Something went wrong"
    });

  } finally {

    if (connection) connection.release();

  }

});

//////
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
app.get("/preview/:bookId", authenticateToken, async (req, res) => {
  const bookId = req.params.bookId;
  const userId = req.user.id;
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query(
      "SELECT id, title FROM books WHERE id = ?",
      [bookId]
    );

    if (rows.length === 0)
      return res.status(404).send("Book not found");

    const book = rows[0];

    const token =
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);

    previewTokens[token] = {
      userId: userId,
      bookId: parseInt(bookId),
      expires: Date.now() + 2 * 60 * 1000
    };

    res.render("preview", {
      pageTitle: `Preview: ${book.title}`,
      bookId: book.id,
      title: book.title,
      previewToken: token
    });

  } catch (err) {

    console.error("Error loading preview:", err);
    res.status(500).send("Error loading preview");

  } finally {

    if (connection) connection.release();

  }

});
/* =========================
   ADD BOOK PAGE
========================= */

app.get("/add-book", authenticateToken, (req, res) => {

  res.render("add_book", {
    pageTitle: "Add Book",
    error: null
  });

});


/* =========================
   SAVE BOOK
========================= */

app.post("/add-book", authenticateToken, upload.single("book_file"), async (req, res) => {

  const { title, author, book_no, description, available_copies, cover_image_url } = req.body;

  const fileBuffer = req.file ? req.file.buffer : null;

  if (!title || !author || !book_no || !fileBuffer) {
    return res.render("add_book", {
      pageTitle: "Add Book",
      error: "All fields are required"
    });
  }

  let connection;

  try {

    connection = await pool.getConnection();

    await connection.query(
`INSERT INTO books
(title, author, book_no, cover_image_url, book_content_file)
VALUES (?,?,?,?,?)`,
[
  title,
  author,
  book_no,
  cover_image_url || "/images/default-cover.png",
  fileBuffer
]
);

    res.redirect("/books?showall=1&message=Book added successfully");

  } catch (err) {

    console.error(err);

    res.render("add_book", {
      pageTitle: "Add Book",
      error: "Database error"
    });

  } finally {

    if (connection) connection.release();
  }
});

app.post("/cart/clear", authenticateTokenAjax, (req, res) => {
  const userId = req.user.id;
  userCarts[userId] = [];
  res.json({ success: true });
});