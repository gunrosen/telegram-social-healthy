const wait = (ms): Promise<any> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(1)
    }, ms)
  })
}

export {
  wait
}
