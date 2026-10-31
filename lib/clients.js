/**
 * 云厂商客户端工厂。
 *
 * 新增厂商时：
 * 1. 在 providers.js 里加元数据和字段校验；
 * 2. 加一个与 AliyunEcsClient / TencentTatClient 同构的客户端（exec 返回
 *    {exitCode, output, status}）；
 * 3. 在这里注册。
 */

import { AliyunEcsClient } from './aliyun.js'
import { TencentTatClient } from './tencent.js'
import { AwsSsmClient } from './aws.js'

const FACTORIES = {
  aliyun: (config) => new AliyunEcsClient(config),
  tencent: (config) => new TencentTatClient(config),
  aws: (config) => new AwsSsmClient(config),
}

export function createClient(providerId, config) {
  const factory = FACTORIES[providerId]
  if (!factory) throw new Error(`不支持的云厂商：${providerId}`)
  return factory(config)
}
