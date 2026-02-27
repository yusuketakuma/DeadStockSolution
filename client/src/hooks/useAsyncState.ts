import { useState } from 'react';

export function useAsyncState() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  return { loading, setLoading, error, setError, message, setMessage };
}
