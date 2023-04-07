import React, { ReactNode } from 'react';
import Navbar from './Navbar';
import Footer from './Footer';

interface IProps {
  children: ReactNode;
}

export default function Layout({ children } : IProps) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
      <Footer />
    </>
  );
}
