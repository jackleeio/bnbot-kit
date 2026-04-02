# 示例代码文档

这是一个包含代码片段的 Markdown 文件示例。

## TypeScript 示例

```typescript
interface User {
  id: number;
  name: string;
}

function greet(user: User): string {
  return `Hello, ${user.name}!`;
}

const user: User = { id: 1, name: "BNBOT User" };
console.log(greet(user));
```

## Python 示例

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print([fibonacci(i) for i in range(10)])
```
