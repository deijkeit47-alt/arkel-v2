export function ArkelLogo({ size = 26 }) {
  return (
    <img
      src="/arkel-logo.jpeg"
      alt="Arkel"
      width={size}
      height={size}
      style={{
        borderRadius: Math.round(size * 0.22),
        objectFit: 'cover',
        display: 'block',
      }}
    />
  )
}
