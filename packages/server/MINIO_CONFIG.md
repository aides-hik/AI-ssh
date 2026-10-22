# 自托管 MinIO 配置参考

当前服务端未启用对象存储集成。以下仅供自行扩展上传功能时配置自托管 MinIO，不包含可用的远程服务器或账号。

在 `packages/server/.env` 中按实际部署填写：

```dotenv
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=replace-with-your-access-key
MINIO_SECRET_KEY=replace-with-your-secret-key
MINIO_BUCKET=documents
```

服务端只读取 `packages/server/.env`。请勿将实际凭据提交到仓库。部署者需自行创建存储服务、访问账号与 bucket，并在实现上传功能后验证连接。
