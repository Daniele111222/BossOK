<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';

onLaunch(() => { console.info('老板批了已启动'); });
</script>

<style>
page { background: #f5f7f6; color: #1f2937; font-size: 30rpx; }
.page { padding: 40rpx 32rpx; }
.title { display: block; font-size: 44rpx; font-weight: 600; margin-bottom: 20rpx; }
.description { display: block; color: #596579; line-height: 1.8; }
.card { background: #fff; border-radius: 20rpx; padding: 32rpx; margin-top: 32rpx; }
.action { margin-top: 32rpx; background: #21654f; color: #fff; }
</style>
