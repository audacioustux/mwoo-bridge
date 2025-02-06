export const requireEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`environment variable ${name} is required`);
  }

  return value;
};
