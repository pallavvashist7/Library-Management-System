create database if not exists library_db;
use library_db;

create table if not exists users (
    id int auto_increment primary key,
    username varchar(50) not null unique,
    email varchar(100) not null unique,
    password varchar(255) not null, 
    created_at timestamp default current_timestamp
);

create table if not exists books (
    id int auto_increment primary key,
    title varchar(255) not null,
    author varchar(10),
    bookn_o varchar(20) unique,
    description text,
    cover_image_url varchar(255),
    available_copies int default 1,
    total_copies int default 1,
    created_at timestamp default current_timestamp
);
DESCRIBE users;