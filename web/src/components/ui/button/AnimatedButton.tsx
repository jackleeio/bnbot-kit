import React, { ReactNode } from 'react'
import { motion } from 'framer-motion'

interface AnimatedButtonProps {
  className?: string
  onClick?: () => void
  disabled?: boolean
  isLoading?: boolean
  isPending?: boolean
  children: ReactNode
}

const AnimatedButton: React.FC<AnimatedButtonProps> = ({
  className = '',
  onClick,
  disabled = false,
  isLoading = false,
  isPending = false,
  children,
}) => {
  const buttonContent = () => {
    if (isLoading || isPending) {
      return (
        <>
          <span className="loading loading-spinner"></span>
          {isLoading ? 'Creating...' : 'Waiting Confirm...'}
        </>
      )
    }
    return children
  }

  return (
    <motion.button
      className={`btn btn-circle btn-neutral btn-block bg-black text-lg text-white disabled:bg-slate-100 disabled:text-slate-400 ${className}`}
      onClick={onClick}
      disabled={disabled || isLoading || isPending}
      whileHover={!disabled && !isLoading && !isPending ? { scale: 1.05 } : {}}
      whileTap={!disabled && !isLoading && !isPending ? { scale: 0.95 } : {}}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.1 }}
    >
      {buttonContent()}
    </motion.button>
  )
}

export default AnimatedButton