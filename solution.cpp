#include <iostream>
#include <vector>
#include <queue>
#include <set>
using namespace std;

int minNumOfWalls(int **a, int m, int n) {
    int tw = 0;
    int dx[] = {0, 0, 1, -1};
    int dy[] = {1, -1, 0, 0};

    while (true) {
        vector<vector<bool>> vis(m, vector<bool>(n, false));
        vector<vector<pair<int,int>>> rg;
        vector<set<pair<int,int>>> th;
        vector<int> wn;

        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                if (a[i][j] == 1 && !vis[i][j]) {
                    vector<pair<int,int>> r;
                    set<pair<int,int>> t;
                    int w = 0;

                    queue<pair<int,int>> q;
                    q.push(make_pair(i, j));
                    vis[i][j] = true;

                    while (!q.empty()) {
                        pair<int,int> c = q.front(); q.pop();
                        int x = c.first, y = c.second;
                        r.push_back(c);

                        for (int d = 0; d < 4; d++) {
                            int nx = x + dx[d], ny = y + dy[d];
                            if (nx < 0 || nx >= m || ny < 0 || ny >= n) continue;

                            if (a[nx][ny] == 1 && !vis[nx][ny]) {
                                vis[nx][ny] = true;
                                q.push(make_pair(nx, ny));
                            } else if (a[nx][ny] == 0) {
                                w++;
                                t.insert(make_pair(nx, ny));
                            }
                        }
                    }
                    rg.push_back(r);
                    th.push_back(t);
                    wn.push_back(w);
                }
            }
        }

        int mt = 0, ch = -1;
        for (int i = 0; i < (int)rg.size(); i++) {
            if ((int)th[i].size() > mt) {
                mt = th[i].size();
                ch = i;
            }
        }
        if (ch == -1 || mt == 0) break;

        tw += wn[ch];
        for (int i = 0; i < (int)rg[ch].size(); i++)
            a[rg[ch][i].first][rg[ch][i].second] = 2;

        for (int i = 0; i < (int)rg.size(); i++) {
            if (i == ch) continue;
            for (set<pair<int,int>>::iterator it = th[i].begin();
                 it != th[i].end(); it++)
                a[it->first][it->second] = 1;
        }
    }
    return tw;
}

int main() {
    int m, n, **a;
    cin >> m >> n;
    a = new int*[m];
    for (int i = 0; i < m; i++)
        a[i] = new int[n];
    for (int i = 0; i < m; i++)
        for (int j = 0; j < n; j++)
            cin >> a[i][j];
    cout << minNumOfWalls(a, m, n);
    return 0;
}
