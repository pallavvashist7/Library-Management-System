drop database if exists library_db;
create database library_db;
use library_db;

drop table if exists users;
create table users (
    id int auto_increment primary key,
    username varchar(50) not null unique,
    email varchar(100) not null unique,
    password varchar(255) not null,
    created_at timestamp default current_timestamp
);

drop table if exists books;
create table books (
    id int auto_increment primary key,
    title varchar(255) not null,
    author varchar(100),
    book_no varchar(20) unique,
    description text,
    book_content_file longblob,
    cover_image_url varchar(255),
    available_copies int default 1,
    total_copies int default 1,
    created_at timestamp default current_timestamp
);

describe users;
describe books;

select * from users;
select * from books;
