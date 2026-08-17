/**
 * USE CASE — Tabs
 *
 * Reference only. Read before adding tabbed navigation.
 *
 * DS rules shown here:
 * - DS tabs are FLAT, not segmented pills. Default `underline` variant: a flat
 *   row where the active tab is gold text + a 2px gold underline.
 * - `header` variant = folder tabs in a gray bar above a white panel.
 * - The non-DS `pill` variant exists for legacy needs; prefer `underline`.
 */
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export function TabsUseCase() {
  return (
    <div className="max-w-2xl p-6">
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <p className="text-md text-muted-foreground">Account overview content.</p>
        </TabsContent>
        <TabsContent value="holdings">
          <p className="text-md text-muted-foreground">Holdings table goes here.</p>
        </TabsContent>
        <TabsContent value="activity">
          <p className="text-md text-muted-foreground">Recent activity feed.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default TabsUseCase;
