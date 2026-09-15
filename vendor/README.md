# vendor/

第三方运行时文件，直接放在仓库里同源提供，不从 CDN 拉。

## 为什么不用 CDN

MediaPipe 的官方模型挂在 `storage.googleapis.com` 上，**这个域名在中国大陆基本不可用**。
如果按官方示例从那儿加载，自动认人这个功能在国内就是永远转圈。

放在同源还顺带解决两件事：加进 Service Worker 缓存之后彻底离线可用；
以及不依赖任何第三方在线服务，jsdelivr 挂了或者变慢都不影响。

代价是仓库多了约 18MB。对一个自己用的工具来说这个代价可以接受，
而且用户第一次打开「认人」时才会下载，之后一直从缓存走。

## 文件

| 文件 | 来源 | 大小 |
|---|---|---|
| `mediapipe/vision_bundle.mjs` | `@mediapipe/tasks-vision@1.0.1` | 152 KB |
| `mediapipe/wasm/vision_wasm_internal.js` | 同上 | 316 KB |
| `mediapipe/wasm/vision_wasm_internal.wasm` | 同上 | 12 MB |
| `mediapipe/pose_landmarker_lite.task` | MediaPipe 官方模型库，float16 版本 | 5.6 MB |

只放了 SIMD 版本的 WASM。极老的设备不支持 WASM SIMD，
那种情况下 `js/vision.js` 会自动回退到 jsdelivr 的 CDN 去取完整的一套。

## 怎么更新

```sh
V=1.0.1
B=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$V
curl -sSo vendor/mediapipe/vision_bundle.mjs              "$B/vision_bundle.mjs"
curl -sSo vendor/mediapipe/wasm/vision_wasm_internal.js   "$B/wasm/vision_wasm_internal.js"
curl -sSo vendor/mediapipe/wasm/vision_wasm_internal.wasm "$B/wasm/vision_wasm_internal.wasm"
curl -sSo vendor/mediapipe/pose_landmarker_lite.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
```

换版本记得同时改 `js/vision.js` 里的 `MP_VERSION`（它只用于 CDN 回退路径）
和 `sw.js` 里的 `VENDOR` 缓存名，否则老缓存不会失效。

MediaPipe 按 Apache-2.0 授权。
