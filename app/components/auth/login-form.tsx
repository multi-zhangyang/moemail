"use client"

import { signIn } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Github } from "lucide-react"

export function LoginForm() {
  const t = useTranslations("auth.loginForm")

  return (
    <Card className="w-[95%] max-w-lg border-2 border-primary/20">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl text-center bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
          {t("title")}
        </CardTitle>
        <CardDescription className="text-center">
          {t("subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <div className="space-y-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signIn("github", { callbackUrl: "/" })}
          >
            <Github className="mr-2 h-4 w-4" />
            {t("actions.githubLogin")}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            {t("ownerOnlyNotice")}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
