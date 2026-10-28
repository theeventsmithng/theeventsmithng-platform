export const metadata = {
  title: "The EventSmith NG — Platform",
  description: "Admin and client platform for The EventSmith NG.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
