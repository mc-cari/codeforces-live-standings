import Navbar from './Navbar'
import Footer from './Footer'
// import react node
import { ReactNode } from 'react'


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
  )
}