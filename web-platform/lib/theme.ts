import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Xám trung tính, hơi tối. Mantine dùng: nền trang = dark[7], thẻ/ô nhập = dark[6],
// hover = dark[5], viền = dark[4], chữ chính = dark[0], chữ phụ = dark[2].
const dark: MantineColorsTuple = [
  "#d9d9d9",
  "#b9b9b9",
  "#8e8e8e",
  "#6a6a6a",
  "#4a4a4a",
  "#3e3e3e",
  "#353535",
  "#2c2c2c",
  "#242424", // dùng cho thanh điều hướng
  "#1b1b1b",
];

// Xanh olive, hợp với màu bàn cờ
const brand: MantineColorsTuple = [
  "#f4f9ec",
  "#e5f0d3",
  "#cde2ab",
  "#b4d481",
  "#9fc75f",
  "#8fbc47",
  "#81b03c",
  "#6f9a33",
  "#5e832b",
  "#4c6a22",
];

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 6 },
  colors: { dark, brand },
  defaultRadius: "md",
  headings: { fontWeight: "700" },
});