import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { success } from "zod";
import { accessToken } from "../utils/jwt.js";

const SALT_ROUND = 10;

export async function register(req, res) {
  try {
    const { name, email, password } = req.validated.body;

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw ApiError.conflict("Email Already Exist");
    }

    const hasedPassword = await bcrypt.hash(password, SALT_ROUND);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hasedPassword,
      },
    });

    res.status(201).json({
      success: true,
      message: "Registered Successfully",
      data: { user, accessToken: accessToken(user) },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.conflict(error.message)
  }
}


export async function login(req, res) {
  try {
    const { email, password } = req.validated.body;

    const user = await prisma.user.findUnique({ where: { email }, omit: { password: false } });

    if(!user) {
        throw ApiError.unAuthorised("invalid email")
    }


    const passwordMatch = await bcrypt.compare(password, user.password)

    if(!passwordMatch) {
        throw ApiError.unAuthorised("invalid password")
    }

    const { password: _hash, ...safeUser } = user;
    

    res.json({
      success: true,
      message: "Logged in Successfully",
      data: { user: safeUser, accessToken: accessToken(user) },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.conflict(error.message)
  }
}




