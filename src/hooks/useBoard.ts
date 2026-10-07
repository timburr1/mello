import { useContext } from 'react';
import { BoardContext } from './boardContext.ts';
import type { BoardContextValue } from './boardContext.ts';

export function useBoard(): BoardContextValue {
  const value = useContext(BoardContext);
  if (!value) throw new Error('useBoard must be used inside a BoardProvider.');
  return value;
}
