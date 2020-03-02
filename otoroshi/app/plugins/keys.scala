package otoroshi.plugins

import models.{ApiKey, ApiKeyRotationInfo, PrivateAppsUser, Target}
import org.joda.time.DateTime
import play.api.libs.json.JsValue
import play.api.libs.typedmap.TypedKey

object Keys {
  val ApiKeyKey             = TypedKey[ApiKey]("otoroshi.core.ApiKey")
  val ApiKeyRotationKey     = TypedKey[ApiKeyRotationInfo]("otoroshi.core.ApiKeyRotationInfo")
  val UserKey               = TypedKey[PrivateAppsUser]("otoroshi.core.UserKey")
  val GeolocationInfoKey    = TypedKey[JsValue]("otoroshi.plugins.GeolocationInfo")
  val UserAgentInfoKey      = TypedKey[JsValue]("otoroshi.plugins.UserAgentInfo")
  val ExtraAnalyticsDataKey = TypedKey[JsValue]("otoroshi.plugins.ExtraAnalyticsData")

  val RequestTimestampKey   = TypedKey[DateTime]("otoroshi.core.RequestTimestamp")
  val RequestStartKey       = TypedKey[Long]("otoroshi.core.RequestStart")
  val RequestWebsocketKey   = TypedKey[Boolean]("otoroshi.core.RequestWebsocket")
  val RequestTargetKey      = TypedKey[Target]("otoroshi.core.RequestTarget")
  val SnowFlakeKey          = TypedKey[String]("otoroshi.core.SnowFlake")
}
